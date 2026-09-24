/** @jsxImportSource @opentui/solid */

import type { JSX } from "@opentui/solid"
import {
  createMemo,
  createSignal,
  createEffect,
  onMount,
  onCleanup,
  untrack,
  Show,
  For,
} from "solid-js"
import { copyText } from "../clipboard"
import { openFilePath } from "../open-file"
import { createT } from "../i18n"
import type { Lang, SortOrder, ScrollMode, ShellEntry, TimeFormat } from "../core/types"
import { visualWidth, truncate, fmtDuration } from "../core/format"
import { rgb, desaturateTo, FALLBACK, MAX_SAT } from "../core/color"
import { SESSION_DATA_KEY, SETTING_KEYS, updateSessionData } from "../core/kv"
import type { ShellPanelApi, ShellInfoLike } from "./api"
import { clearTick } from "./store"
import { entryKey, findShellEntryKey, mergeShellEntry } from "./entry-map"
import { durationOf, entryFromShellInfo, isTerminal, scanShellEntries, tailLines } from "./shell-data"

/** Entry row prefix: expand arrow + space + status dot + space */
const LEFT_PAD = 4
/** Maximum number of output preview lines */
const OUTPUT_LINES = 10

interface ShellSessionRecord {
  ts: number
  entries: ShellEntry[]
  scroll: number
  expanded: string
  clearedIds?: string[]
}

export function ShellPanel(props: {
  api: ShellPanelApi
  theme: Record<string, unknown>
  lang: () => Lang
  maxEntries: () => number
  sortOrder: () => SortOrder
  scrollMode: () => ScrollMode
  open: () => boolean
  setOpen: (v: boolean) => void
  showEntryTime: () => boolean
  showEntryCwd: () => boolean
  showEntryExit: () => boolean
  timeFormat: () => TimeFormat
  notifyOnFinish: () => boolean
  notifyThresholdMs: () => number
  sessionId: string
}): JSX.Element {
  const t = createT(() => props.lang())

  // ── Persisted session record (multi-instance safe: updates go through updateSessionData) ──
  const loadRecord = (): ShellSessionRecord => {
    try {
      const raw = props.api.kv.get(SESSION_DATA_KEY, "{}")
      const data = JSON.parse(String(raw)) as Record<string, ShellSessionRecord>
      const rec = data[props.sessionId]
      if (rec && Array.isArray(rec.entries)) return rec
    } catch {}
    return { ts: Date.now(), entries: [], scroll: 0, expanded: "" }
  }
  const initial = loadRecord()
  const clearedIds = new Set<string>(initial.clearedIds ?? [])
  /** Entries already on disk/in history at startup: marked silently, with no notification (only commands started during this mount notify). */
  const suppressed = new Set<string>(initial.entries.map((e) => entryKey(e)))

  const [entryMap, setEntryMap] = createSignal<Map<string, ShellEntry>>(
    new Map(initial.entries.map((e) => [entryKey(e), e])),
  )
  const [scrollOffset, setScrollOffset] = createSignal(initial.scroll)
  const [expanded, setExpanded] = createSignal(initial.expanded)
  const [now, setNow] = createSignal(Date.now())
  const [hoveredMoreAbove, setHoveredMoreAbove] = createSignal(false)
  const [hoveredMoreBelow, setHoveredMoreBelow] = createSignal(false)
  const [outputCache, setOutputCache] = createSignal<Map<string, { text: string; truncated?: boolean }>>(new Map())

  let boxEl: any
  let persistTimer: ReturnType<typeof setTimeout> | undefined
  let registryReady = false
  let suppressedRegistry = false

  // ── Palette (Morandi style, theme-adaptive) ──
  const pal = () => {
    const th = props.theme as Record<string, string>
    return {
      primary: th.primary ?? FALLBACK.primary,
      text: desaturateTo(th.text, MAX_SAT, FALLBACK.text),
      muted: desaturateTo(th.textMuted, MAX_SAT, FALLBACK.muted),
      success: desaturateTo(th.success, MAX_SAT, FALLBACK.success),
      warning: desaturateTo(th.warning, MAX_SAT, FALLBACK.warning),
      error: desaturateTo(th.error, MAX_SAT, FALLBACK.error),
    }
  }

  const panelWidth = () => {
    const w = boxEl?.width
    return typeof w === "number" && w > 0 ? Math.max(20, w) : 28
  }
  const sep = () => "\u2500".repeat(panelWidth())

  const firstLine = (s: string) => (s.split("\n")[0] ?? "").trim()

  const pulseColor = () => {
    const a = rgb(pal().muted)
    const b = rgb(pal().warning)
    if (!a || !b) return pal().warning
    const t = (Math.sin(((now() % 2000) / 2000) * Math.PI * 2 - Math.PI / 2) + 1) / 2
    const mix = (x: number, y: number) => Math.round(x + (y - x) * t)
    return "#" + [mix(a.r, b.r), mix(a.g, b.g), mix(a.b, b.b)].map((v) => Math.max(0, Math.min(255, v)).toString(16).padStart(2, "0")).join("")
  }

  const statusGlyph = (e: ShellEntry): string => {
    if (e.status === "running") return "\u25cf"
    if (e.status === "exited") return e.exit !== undefined && e.exit !== 0 ? "\u2717" : "\u2713"
    if (e.status === "killed") return "\u2298"
    return "\u2717"
  }
  const statusColorOf = (e: ShellEntry): string => {
    if (e.status === "running") return pulseColor()
    if (e.status === "exited") return e.exit !== undefined && e.exit !== 0 ? pal().error : pal().success
    if (e.status === "killed") return pal().muted
    return pal().error
  }
  const statusText = (e: ShellEntry): string => {
    switch (e.status) {
      case "running": return t("status.running")
      case "exited": return t("status.exited")
      case "timeout": return t("status.timeout")
      case "killed": return t("status.killed")
      default: return t("status.error")
    }
  }

  const expandedPad = (label: string) => " ".repeat(Math.max(1, 10 - visualWidth(label)))
  const expandedValAvail = () => Math.max(10, panelWidth() - 4 - 12)

  const durationOfEntry = (e: ShellEntry) => durationOf(e, now())

  // ── Persistence ──
  const persist = (entries: Map<string, ShellEntry>) => {
    const list = [...entries.values()]
    void Promise.resolve(updateSessionData(props.api.kv, (data) => {
      data[props.sessionId] = {
        ts: Date.now(),
        entries: list,
        scroll: scrollOffset(),
        expanded: expanded(),
        clearedIds: [...clearedIds],
      }
    })).catch(() => {})
  }
  const queuePersist = () => {
    if (persistTimer) clearTimeout(persistTimer)
    persistTimer = setTimeout(() => {
      persistTimer = undefined
      persist(untrack(entryMap))
    }, 150)
  }

  // ── Notifications (only for finished commands past the threshold; the notified flag prevents duplicates) ──
  const checkNotifications = () => {
    if (!props.notifyOnFinish()) return
    const threshold = props.notifyThresholdMs()
    const nowMs = Date.now()
    const pending: ShellEntry[] = []
    let changed = false
    setEntryMap((prev) => {
      const next = new Map(prev)
      for (const [k, e] of next) {
        if (!isTerminal(e.status) || e.notified) continue
        if (suppressed.has(k)) {
          next.set(k, { ...e, notified: true })
          changed = true
          continue
        }
        if (durationOf(e, nowMs) < threshold) continue
        next.set(k, { ...e, notified: true })
        pending.push(e)
        changed = true
      }
      return changed ? next : prev
    })
    if (!changed) return
    queuePersist()
    for (const e of pending) {
      const detail = e.exit !== undefined ? `exit ${e.exit}` : statusText(e)
      void props.api.attention.notify({
        title: t("notify.title"),
        message: `${firstLine(e.command)} · ${detail}`,
      })
    }
  }

  // ── Entry merge / persist ──
  const applyEntries = (incoming: ShellEntry[], opts?: { fromScan?: boolean }) => {
    let changed = false
    setEntryMap((prev) => {
      const next = new Map(prev)
      for (const inc of incoming) {
        let k = findShellEntryKey(next, inc)
        if (!k && inc.shellID) {
          // Registry record for a command whose history entry never carried a
          // shellID (host cache gap): adopt that entry instead of duplicating it.
          for (const [key, e] of next) {
            if (e.shellID || e.status !== "running" || e.source !== inc.source) continue
            if (e.command.trim() !== inc.command.trim()) continue
            k = key
            break
          }
        }
        if (!k && !inc.shellID && inc.source === "agent") {
          // History entry for a shell already tracked through the registry: same
          // command started around the same time = the same execution, adopt it.
          for (const [key, e] of next) {
            if (!e.shellID || e.source !== inc.source) continue
            if (e.command.trim() !== inc.command.trim()) continue
            if (e.startedAt === undefined || inc.startedAt === undefined) continue
            if (Math.abs(e.startedAt - inc.startedAt) > 10_000) continue
            k = key
            break
          }
        }
        const existing = k ? next.get(k) : undefined
        if (!existing && opts?.fromScan && clearedIds.has(entryKey(inc))) continue
        const merged = existing ? mergeShellEntry(existing, inc) : inc
        if (merged.status === "running") clearedIds.delete(entryKey(merged))
        if (opts?.fromScan && isTerminal(merged.status)) suppressed.add(entryKey(merged))
        next.set(k ?? entryKey(merged), merged)
        changed = true
      }
      return changed ? next : prev
    })
    if (changed) {
      queuePersist()
      checkNotifications()
    }
  }

  const loadOutput = async (e: ShellEntry) => {
    if (!e.shellID) return
    const out = await props.api.shell.readOutput(e.shellID)
    if (!out) return
    setOutputCache((prev) => new Map(prev).set(entryKey(e), { text: out.output, truncated: out.truncated }))
  }

  /**
   * Registry reconciliation: the host only keeps "running" shell records.
   * Entries started in the background earlier that are no longer in the registry after a plugin
   * restart = the process has ended (the ended event was missed) — closed out on hard evidence,
   * with no guessing from timestamps.
   *
   * History entries without a shellID (host cache gap) are settled too when their command is
   * not among the registry's live shells of this session; those are silent (never notified).
   */
  const pruneFinished = (present: Set<string>, liveCommands: Set<string>) => {
    if (!registryReady) return
    let changed = false
    const silent = new Set<string>()
    setEntryMap((prev) => {
      const next = new Map(prev)
      for (const [k, e] of next) {
        if (e.status !== "running") continue
        if (e.shellID) {
          if (present.has(e.shellID)) continue
        } else if (liveCommands.has(e.command.trim())) {
          continue
        } else {
          silent.add(k)
        }
        next.set(k, { ...e, status: "exited", endedAt: e.endedAt ?? Date.now() })
        changed = true
      }
      // Drop history twins of registry-tracked entries (same command, same start):
      // the registry record is the authoritative one. Remember the dropped key so
      // the history scan does not resurrect the twin.
      const tracked = [...next.values()].filter((e) => e.shellID !== undefined)
      for (const [k, e] of next) {
        if (e.shellID !== undefined) continue
        const twin = tracked.find((t) =>
          t.source === e.source &&
          t.command.trim() === e.command.trim() &&
          t.startedAt !== undefined && e.startedAt !== undefined &&
          Math.abs(t.startedAt - e.startedAt) <= 10_000)
        if (!twin) continue
        clearedIds.add(k)
        next.delete(k)
        changed = true
      }
      return changed ? next : prev
    })
    for (const k of silent) suppressed.add(k)
    if (changed) {
      queuePersist()
      checkNotifications()
    }
  }

  const syncRegistry = async () => {
    const ok = await props.api.shell.sync()
    if (!ok) return
    const map = untrack(entryMap)
    const present = new Set<string>()
    const liveCommands = new Set<string>()
    const entries: ShellEntry[] = []
    for (const s of props.api.shell.list()) {
      if (String((s.metadata ?? {}).sessionID ?? "") !== props.sessionId) continue
      present.add(s.id)
      if (s.command) liveCommands.add(String(s.command).trim())
      const k = findShellEntryKey(map, { id: s.id, shellID: s.id } as ShellEntry)
      entries.push(entryFromShellInfo(s, k ? map.get(k) : undefined))
    }
    registryReady = true
    const firstSync = !suppressedRegistry
    suppressedRegistry = true
    if (firstSync) for (const e of entries) suppressed.add(entryKey(e))
    applyEntries(entries)
    pruneFinished(present, liveCommands)
    const exp = untrack(expandedEntry)
    if (exp?.shellID && exp.status === "running") void loadOutput(exp)
  }

  const clearFinished = () => {
    let removed = 0
    setEntryMap((prev) => {
      const next = new Map(prev)
      for (const [k, e] of next) {
        if (!isTerminal(e.status)) continue
        clearedIds.add(k)
        next.delete(k)
        removed++
      }
      return removed > 0 ? next : prev
    })
    if (removed > 0) {
      queuePersist()
      props.api.ui.toast(t("toast.cleared"), { variant: "success" })
    }
  }

  // ── Lifecycle: history scan + live events + heartbeat/reconciliation ──
  onMount(() => {
    void (async () => {
      await syncRegistry()
      applyEntries(scanShellEntries(props.api.session.messages(props.sessionId) ?? []), { fromScan: true })
      const exp = untrack(expandedEntry)
      if (exp?.shellID && exp.status === "running") void loadOutput(exp)
    })()

    const offStarted = props.api.shell.onStarted((ev) => {
      if (ev.sessionID !== props.sessionId) return
      suppressed.delete(ev.shell.id)
      const map = untrack(entryMap)
      const k = findShellEntryKey(map, { id: ev.shell.id, shellID: ev.shell.id } as ShellEntry)
      applyEntries([entryFromShellInfo(ev.shell, k ? map.get(k) : undefined)])
    })
    const offEnded = props.api.shell.onEnded((ev) => {
      if (ev.sessionID !== props.sessionId) return
      const map = untrack(entryMap)
      const k = findShellEntryKey(map, { id: ev.shell.id, shellID: ev.shell.id } as ShellEntry)
      const entry = entryFromShellInfo(ev.shell, k ? map.get(k) : undefined)
      if (ev.output?.output) {
        entry.output = ev.output.output
        entry.truncated = ev.output.truncated
      }
      applyEntries([entry])
      if (untrack(expanded) === entryKey(entry)) void loadOutput(entry)
    })

    const clock = setInterval(() => setNow(Date.now()), 500)
    const reconcile = setInterval(() => void syncRegistry(), 3000)
    onCleanup(() => {
      offStarted()
      offEnded()
      clearInterval(clock)
      clearInterval(reconcile)
      if (persistTimer) clearTimeout(persistTimer)
    })
  })

  // "Clear finished" triggered by the slash command.
  createEffect(() => {
    const tick = clearTick()
    if (tick === 0) return
    untrack(() => clearFinished())
  })

  // Fetch output when a running shell is expanded.
  createEffect(() => {
    const e = expandedEntry()
    if (e?.status === "running" && e.shellID) void loadOutput(e)
  })

  // ── Sorting / paging ──
  const sorted = createMemo(() => {
    const list = [...entryMap().values()]
    list.sort((a, b) => (props.sortOrder() === "asc" ? a.startedAt - b.startedAt : b.startedAt - a.startedAt))
    return list
  })
  const max = () => Math.max(1, Math.floor(props.maxEntries()) || 10)
  const hiddenAbove = createMemo(() => Math.max(0, Math.min(scrollOffset(), sorted().length - max())))
  const hiddenBelow = createMemo(() => Math.max(0, sorted().length - max() - scrollOffset()))
  const visibleList = createMemo(() => sorted().slice(scrollOffset(), scrollOffset() + max()))
  const anyEntry = createMemo(() => entryMap().size > 0)
  const summary = createMemo(() => {
    let running = 0
    let failed = 0
    for (const e of entryMap().values()) {
      if (e.status === "running") running++
      else if (e.status === "error" || e.status === "timeout" || e.status === "killed" || (e.status === "exited" && e.exit !== undefined && e.exit !== 0)) failed++
    }
    return { running, failed, total: entryMap().size }
  })

  // Header summary parts: compact counts, right-aligned like the sibling plugin.
  const headerSummary = createMemo(() => {
    const s = summary()
    return {
      running: s.running > 0 ? `\u25cf${s.running}` : "",
      failed: s.failed > 0 ? `\u2717${s.failed}` : "",
      total: s.total > 0 ? String(s.total) : "",
    }
  })
  const headerSummaryCols = createMemo(() => {
    const h = headerSummary()
    let w = visualWidth(h.running)
    if (h.failed) w += 1 + visualWidth(h.failed)
    if (h.total) w += 3 + visualWidth(h.total) // " · "
    return w
  })
  const headerSpacer = () => {
    const left = 2 + visualWidth(t("panel.title")) // arrow + space + title
    return Math.max(1, panelWidth() - left - headerSummaryCols())
  }

  // Clamp the offset back into range when the list shrinks.
  createEffect(() => {
    const maxOff = Math.max(0, sorted().length - max())
    if (scrollOffset() > maxOff) {
      setScrollOffset(maxOff)
      queuePersist()
    }
  })

  const expandedEntry = createMemo(() => {
    const k = expanded()
    return k ? entryMap().get(k) : undefined
  })
  const outputLines = createMemo(() => {
    const e = expandedEntry()
    if (!e) return [] as string[]
    const raw = outputCache().get(entryKey(e))?.text ?? e.output
    if (!raw) return [] as string[]
    return tailLines(raw, OUTPUT_LINES).split("\n")
  })

  const toggleOpen = () => {
    const next = !props.open()
    props.setOpen(next)
    void Promise.resolve(props.api.kv.set(SETTING_KEYS.open, next)).catch(() => {})
  }
  const toggleExpand = (k: string) => {
    setExpanded(expanded() === k ? "" : k)
    queuePersist()
  }
  const setScroll = (next: number) => {
    setScrollOffset(next)
    queuePersist()
  }
  const onWheel = (e: any) => {
    if (props.scrollMode() === "click") return
    const total = sorted().length
    const m = max()
    if (total <= m) return
    const dir = e?.button === 0 ? 1 : -1
    setScroll(Math.max(0, Math.min(scrollOffset() + dir * m, total - m)))
  }

  // ── Actions ──
  const killEntry = async (entry: ShellEntry) => {
    if (!entry.shellID) return
    const ok = await props.api.ui.confirm(t("confirm.kill.title"), t("confirm.kill.message"))
    if (!ok) return
    try {
      await props.api.shell.kill(entry.shellID)
      props.api.ui.toast(t("toast.killed"), { title: firstLine(entry.command), variant: "success" })
    } catch {
      props.api.ui.toast(t("toast.kill_failed"), { title: firstLine(entry.command), variant: "error" })
    }
  }
  const copyEntry = async (entry: ShellEntry) => {
    try {
      const res = await copyText(entry.command)
      if (res?.copied) props.api.ui.toast(t("toast.copied"), { variant: "success" })
      else props.api.ui.toast(t("toast.copy_failed"), { variant: "warning" })
    } catch {
      props.api.ui.toast(t("toast.copy_failed"), { variant: "warning" })
    }
  }
  const openOutput = (entry: ShellEntry) => {
    if (!entry.file || !openFilePath(entry.file)) {
      props.api.ui.toast(t("toast.open_failed"), { variant: "warning" })
    }
  }

  // ── Rendering ──
  return (
    <box ref={(el: any) => (boxEl = el)} flexDirection="column" gap={0}>
      {/* header */}
      <text onMouseUp={toggleOpen}>
        <span style={{ fg: pal().muted }}>{props.open() ? "\u25bc " : "\u25b6 "}</span>
        <span style={{ fg: pal().primary }}>{t("panel.title")}</span>
        <Show when={anyEntry()}>
          <span style={{ fg: pal().muted }}>{" ".repeat(headerSpacer())}</span>
          <Show when={headerSummary().running}>
            <span style={{ fg: pal().warning }}>{headerSummary().running}</span>
          </Show>
          <Show when={headerSummary().failed}>
            <span style={{ fg: pal().error }}>{" " + headerSummary().failed}</span>
          </Show>
          <Show when={headerSummary().total}>
            <span style={{ fg: pal().muted }}>{" \u00b7 " + headerSummary().total}</span>
          </Show>
        </Show>
      </text>

      <Show when={props.open()}>
        <text fg={pal().muted}>{sep()}</text>
        <Show
          when={anyEntry()}
          fallback={
            <text style={{ fg: pal().muted }}>
              {"  > "}{t("panel.empty")}
            </text>
          }
        >
          <box onMouseScroll={onWheel} flexDirection="column" gap={0}>
            <Show when={hiddenAbove() > 0}>
              <text
                onMouseOver={() => setHoveredMoreAbove(true)}
                onMouseOut={() => setHoveredMoreAbove(false)}
                onMouseUp={() => {
                  const total = sorted().length
                  const m = max()
                  if (total <= m) return
                  setScroll(Math.max(0, scrollOffset() - m))
                }}
              >
                <span style={{ fg: hoveredMoreAbove() ? pal().warning : pal().muted }}>
                  {"  \u2191 "}{hiddenAbove()}{" "}{t("scroll.more")}
                </span>
              </text>
            </Show>

            <For each={visibleList()}>
              {(entry) => {
                const key = entryKey(entry)
                const isExpanded = () => expanded() === key
                const isRunning = () => entry.status === "running"
                const timeText = () =>
                  props.showEntryTime() && (durationOfEntry(entry) >= 2000 || entry.endedAt !== undefined)
                    ? fmtDuration(durationOfEntry(entry), isRunning(), props.timeFormat())
                    : ""
                const exitText = () =>
                  props.showEntryExit() && isTerminal(entry.status) && entry.exit !== undefined ? `exit ${entry.exit}` : ""
                const suffixW = () => {
                  let w = 0
                  const tt = timeText()
                  if (tt) w += 1 + visualWidth(tt)
                  const et = exitText()
                  if (et) w += 1 + visualWidth(et)
                  return w
                }
                const labelAvail = () => Math.max(6, panelWidth() - LEFT_PAD - suffixW() - 1)
                const labelText = () => {
                  const maxCols = labelAvail()
                  const text = firstLine(entry.command) || "\u2014"
                  const truncated = truncate(text, maxCols)
                  return truncated + " ".repeat(Math.max(0, maxCols - visualWidth(truncated)))
                }
                const heading = () =>
                  entry.source === "user"
                    ? firstLine(entry.command) || t("source.user")
                    : firstLine(entry.command) || t("source.agent")

                return (
                  <>
                    <text onMouseUp={() => toggleExpand(key)}>
                      <span style={{ fg: pal().muted }}>{isExpanded() ? "\u25bc" : "\u25b6"}</span>
                      {" "}
                      <span style={{ fg: statusColorOf(entry) }}>{statusGlyph(entry)}</span>
                      {" "}
                      <span style={{ fg: pal().text }}>{labelText()}</span>
                      <Show when={timeText()}>
                        <span style={{ fg: isRunning() ? pal().warning : pal().muted }}>{" " + timeText()}</span>
                      </Show>
                      <Show when={exitText()}>
                        <span style={{ fg: entry.exit === 0 ? pal().success : pal().error }}>{" " + exitText()}</span>
                      </Show>
                    </text>

                    <Show when={isExpanded()}>
                      <text>
                        {"  "}
                        <span style={{ fg: pal().primary }}>{t("label.source")}: </span>
                        <span style={{ fg: pal().muted }}>{expandedPad(t("label.source"))}</span>
                        <span style={{ fg: pal().muted }}>{entry.source === "user" ? t("source.user") : t("source.agent")}</span>
                      </text>
                      <text>
                        {"  "}
                        <span style={{ fg: pal().primary }}>{t("label.command")}: </span>
                        <span style={{ fg: pal().muted }}>{expandedPad(t("label.command"))}</span>
                        <span style={{ fg: pal().text }}>{truncate(heading(), expandedValAvail())}</span>
                      </text>
                      <Show when={entry.cwd}>
                        <text>
                          {"  "}
                          <span style={{ fg: pal().primary }}>{t("label.cwd")}: </span>
                          <span style={{ fg: pal().muted }}>{expandedPad(t("label.cwd"))}</span>
                          <span style={{ fg: pal().muted }}>{truncate(String(entry.cwd), expandedValAvail())}</span>
                        </text>
                      </Show>
                      <text>
                        {"  "}
                        <span style={{ fg: pal().primary }}>{t("label.time")}: </span>
                        <span style={{ fg: pal().muted }}>{expandedPad(t("label.time"))}</span>
                        <span style={{ fg: pal().muted }}>{fmtDuration(durationOfEntry(entry), isRunning(), props.timeFormat())}</span>
                      </text>
                      <Show when={entry.shell}>
                        <text>
                          {"  "}
                          <span style={{ fg: pal().primary }}>{t("label.shell")}: </span>
                          <span style={{ fg: pal().muted }}>{expandedPad(t("label.shell"))}</span>
                          <span style={{ fg: pal().muted }}>{truncate(String(entry.shell), expandedValAvail())}</span>
                        </text>
                      </Show>
                      <Show when={entry.pid !== undefined}>
                        <text>
                          {"  "}
                          <span style={{ fg: pal().primary }}>{t("label.pid")}: </span>
                          <span style={{ fg: pal().muted }}>{expandedPad(t("label.pid"))}</span>
                          <span style={{ fg: pal().muted }}>{String(entry.pid)}</span>
                        </text>
                      </Show>
                      <Show when={entry.timeout !== undefined}>
                        <text>
                          {"  "}
                          <span style={{ fg: pal().primary }}>{t("label.timeout")}: </span>
                          <span style={{ fg: pal().muted }}>{expandedPad(t("label.timeout"))}</span>
                          <span style={{ fg: pal().muted }}>{String(entry.timeout)}ms</span>
                        </text>
                      </Show>
                      <Show when={isTerminal(entry.status)}>
                        <text>
                          {"  "}
                          <span style={{ fg: pal().primary }}>{t("label.exit")}: </span>
                          <span style={{ fg: pal().muted }}>{expandedPad(t("label.exit"))}</span>
                          <span style={{ fg: statusColorOf(entry) }}>
                            {statusText(entry)}{entry.exit !== undefined ? ` \u00b7 exit ${entry.exit}` : ""}
                          </span>
                        </text>
                      </Show>
                      <Show when={entry.file}>
                        <text>
                          {"  "}
                          <span style={{ fg: pal().primary }}>{t("label.file")}: </span>
                          <span style={{ fg: pal().muted }}>{expandedPad(t("label.file"))}</span>
                          <span style={{ fg: pal().muted }}>{truncate(String(entry.file), expandedValAvail())}</span>
                        </text>
                      </Show>

                      <Show when={outputLines().length > 0}>
                        <text>
                          {"  "}
                          <span style={{ fg: pal().primary }}>{t("label.output")}: </span>
                        </text>
                        <For each={outputLines()}>
                          {(line) => (
                            <text>
                              <span style={{ fg: pal().muted }}>{"  \u2502 "}</span>
                              <span style={{ fg: pal().text }}>{truncate(line, Math.max(8, panelWidth() - 6))}</span>
                            </text>
                          )}
                        </For>
                      </Show>

                      <box flexDirection="row" gap={0}>
                        <text style={{ fg: pal().muted }}>{"  "}</text>
                        <Show when={entry.status === "running" && entry.shellID}>
                          <text onMouseUp={() => void killEntry(entry)}>
                            <span style={{ fg: pal().error }}>{`[${t("action.kill")}]`}</span>
                          </text>
                          <text style={{ fg: pal().muted }}>{"  "}</text>
                        </Show>
                        <text onMouseUp={() => void copyEntry(entry)}>
                          <span style={{ fg: pal().primary }}>{`[${t("action.copy")}]`}</span>
                        </text>
                        <Show when={entry.file}>
                          <text style={{ fg: pal().muted }}>{"  "}</text>
                          <text onMouseUp={() => openOutput(entry)}>
                            <span style={{ fg: pal().primary }}>{`[${t("action.open")}]`}</span>
                          </text>
                        </Show>
                      </box>
                    </Show>
                  </>
                )
              }}
            </For>

            <Show when={hiddenBelow() > 0}>
              <text
                onMouseOver={() => setHoveredMoreBelow(true)}
                onMouseOut={() => setHoveredMoreBelow(false)}
                onMouseUp={() => {
                  const total = sorted().length
                  const m = max()
                  if (total <= m) return
                  setScroll(Math.min(scrollOffset() + m, total - m))
                }}
              >
                <span style={{ fg: hoveredMoreBelow() ? pal().warning : pal().muted }}>
                  {"  \u2193 "}{hiddenBelow()}{" "}{t("scroll.more")}
                </span>
              </text>
            </Show>
          </box>
        </Show>
      </Show>
    </box>
  )
}
