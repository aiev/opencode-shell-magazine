import type { ShellEntry, ShellStatus } from "../core/types"
import type { ShellInfoLike } from "./api"

const num = (v: unknown): number | undefined => {
  const n = Number(v)
  return Number.isFinite(n) ? n : undefined
}

export function isTerminal(status: ShellStatus): boolean {
  return status !== "running"
}

/** Host-reported status string → panel status (unknown is treated as running). */
export function normalizeShellStatus(raw: unknown): ShellStatus {
  switch (String(raw ?? "")) {
    case "exited":
    case "completed":
      return "exited"
    case "timeout":
      return "timeout"
    case "killed":
      return "killed"
    case "error":
    case "failed":
      return "error"
    default:
      return "running"
  }
}

/** Tool part content → plain text (same semantics as subagent-magazine's toV1Part). */
export function contentToText(content: unknown): string | undefined {
  if (typeof content === "string") return content
  if (!Array.isArray(content)) return undefined
  const parts = content
    .map((c) => {
      if (typeof c === "string") return c
      const o = c as Record<string, any>
      if (o?.type === "text") return String(o.text ?? "")
      if (o?.type === "file") return String(o.path ?? o.filename ?? "")
      return ""
    })
    .filter((s) => s.length > 0)
  return parts.length ? parts.join("\n") : undefined
}

/** Host ShellInfo (registry/event) → panel entry; prev preserves known fields such as source. */
export function entryFromShellInfo(info: ShellInfoLike, prev?: Partial<ShellEntry>): ShellEntry {
  return {
    ...prev,
    id: info.id,
    shellID: info.id,
    source: prev?.source ?? "agent",
    command: info.command || prev?.command || "",
    cwd: info.cwd ?? prev?.cwd,
    shell: info.shell ?? prev?.shell,
    pid: info.pid ?? prev?.pid,
    file: info.file ?? prev?.file,
    timeout: prev?.timeout,
    status: info.status,
    exit: typeof info.exit === "number" ? info.exit : prev?.exit,
    startedAt: info.time?.started ?? prev?.startedAt ?? Date.now(),
    endedAt: info.time?.completed ?? prev?.endedAt,
    output: prev?.output,
    truncated: prev?.truncated,
    notified: prev?.notified,
  }
}

/** A shell tool part inside an assistant message → panel entry (history scan). */
export function entryFromToolPart(part: Record<string, any>): ShellEntry | undefined {
  if (!part || part.type !== "tool") return undefined
  const name = String(part.name ?? part.tool ?? "")
  if (name !== "shell") return undefined
  const st = (part.state ?? {}) as Record<string, any>
  const input = (st.input ?? {}) as Record<string, any>
  const meta = { ...(part.metadata ?? {}), ...(st.metadata ?? {}) } as Record<string, any>
  const shellID = meta.shellID !== undefined ? String(meta.shellID) : undefined
  const callId = part.id !== undefined ? String(part.id) : undefined
  const id = shellID ?? (callId ? `tool:${callId}` : undefined)
  if (!id) return undefined
  const time = (part.time ?? st.time ?? {}) as Record<string, any>
  const raw = String(st.status ?? "")
  // Background command: the tool call has returned (completed) but the process is still running (metadata.status running).
  const background = shellID !== undefined && String(meta.status ?? "") === "running"
  const status: ShellStatus = raw === "error" ? "error" : raw === "completed" && !background ? "exited" : "running"
  return {
    id,
    shellID,
    source: "agent",
    command: typeof input.command === "string" ? input.command : "",
    cwd: typeof input.workdir === "string" ? input.workdir : undefined,
    timeout: num(input.timeout),
    status,
    exit: num(meta.exit),
    startedAt: num(time.created) ?? num(time.ran) ?? Date.now(),
    // For a background command, the part completion time only means the spawn succeeded, not that the process exited — so it is not trusted.
    endedAt: shellID ? undefined : status === "running" ? undefined : num(time.completed),
    output: contentToText(st.content) ?? (typeof st.output === "string" ? st.output : undefined),
    truncated: meta.truncated === true,
  }
}

/** In-session shell message (user !command) → panel entry. */
export function entryFromShellMessage(msg: Record<string, any>): ShellEntry | undefined {
  if (!msg || String(msg.type ?? "") !== "shell") return undefined
  const shellID = msg.shellID !== undefined ? String(msg.shellID) : undefined
  const status = normalizeShellStatus(msg.status)
  return {
    id: shellID ?? `msg:${String(msg.id ?? "")}`,
    shellID,
    source: "user",
    command: typeof msg.command === "string" ? msg.command : "",
    status,
    exit: num(msg.exit),
    startedAt: num(msg.time?.created) ?? Date.now(),
    endedAt: num(msg.time?.completed),
    output: msg.output && typeof msg.output.output === "string" ? msg.output.output : undefined,
    truncated: msg.output?.truncated === true,
  }
}

/** Scan a message list for historical shells (tool parts + shell messages). */
export function scanShellEntries(messages: unknown[]): ShellEntry[] {
  const out: ShellEntry[] = []
  for (const raw of messages) {
    const msg = raw as Record<string, any>
    if (!msg) continue
    const fromShell = entryFromShellMessage(msg)
    if (fromShell) { out.push(fromShell); continue }
    if (!Array.isArray(msg.content)) continue
    for (const part of msg.content) {
      const entry = entryFromToolPart(part as Record<string, any>)
      if (entry) out.push(entry)
    }
  }
  return out
}

/** Take the last few lines of text (used for the output preview). */
export function tailLines(text: string, maxLines: number): string {
  const lines = text.replace(/\r\n?/g, "\n").split("\n")
  if (lines.length <= maxLines) return text
  return lines.slice(lines.length - maxLines).join("\n")
}

/** Entry duration (now while running, endedAt once finished). */
export function durationOf(entry: ShellEntry, now: number): number {
  const end = entry.endedAt ?? (entry.status === "running" ? now : entry.startedAt)
  return Math.max(0, end - entry.startedAt)
}
