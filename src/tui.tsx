/** @jsxImportSource @opentui/solid */

import { createSignal } from "solid-js"
import type { Context, PluginModule } from "./v2/context"
import { createShellApi } from "./v2/adapter"
import { makeCommands } from "./v2/commands"
import { mapTheme } from "./v2/theme"
import { ShellPanel } from "./panel/ShellPanel"
import { FooterStatus } from "./panel/FooterStatus"
import type { ShellPanelApi } from "./panel/api"
import type { Lang, SharedSignals, SortOrder, ScrollMode, TimeFormat } from "./core/types"
import { TIME_FORMATS } from "./core/format"
import { SETTING_KEYS } from "./core/kv"
import { LANG_META, detectLang, createT } from "./i18n"

/** The command layer must be registered in the app slot: commands must stay available when the sidebar is hidden. */
function CommandRoot(props: {
  context: Context
  api: ShellPanelApi
  signals: SharedSignals
}) {
  props.context.keymap.layer(() => ({
    mode: "global" as const,
    commands: makeCommands(props.context, props.api, props.signals),
  }))
  return null
}

/** Panel root component: renders ShellPanel (see CommandRoot for the command layer). */
function PluginRoot(props: {
  api: ShellPanelApi
  theme: Record<string, unknown>
  signals: SharedSignals
  sessionID: string
}) {
  return (
    <ShellPanel
      api={props.api}
      theme={props.theme}
      lang={props.signals.lang}
      maxEntries={props.signals.maxEntries}
      sortOrder={props.signals.sortOrder}
      scrollMode={props.signals.scrollMode}
      open={props.signals.open}
      setOpen={props.signals.setOpen}
      showEntryTime={props.signals.showEntryTime}
      showEntryCwd={props.signals.showEntryCwd}
      showEntryExit={props.signals.showEntryExit}
      showSubagents={props.signals.showSubagents}
      border={props.signals.border}
      timeFormat={props.signals.timeFormat}
      notifyOnFinish={props.signals.notifyOnFinish}
      notifyThresholdMs={props.signals.notifyThresholdMs}
      sessionId={props.sessionID}
    />
  )
}

/**
 * V2 entry point: setup creates the shared signals + ShellPanelApi + command layer + sidebar slot.
 * Signal initial values are restored from KV; the panel is prepended to sidebar.content.
 */
const mod: PluginModule = {
  id: "opencode-shell-magazine",
  setup(context: Context) {
    const api = createShellApi(context)

    const storedLang = String(api.kv.get(SETTING_KEYS.lang, ""))
    const initialLang: Lang = LANG_META.some((m) => m.code === storedLang) ? (storedLang as Lang) : detectLang()
    const [lang, setLang] = createSignal<Lang>(initialLang)
    const [maxEntries, setMaxEntries] = createSignal<number>(Number(api.kv.get(SETTING_KEYS.maxEntries, "10")) || 10)
    const [sortOrder, setSortOrder] = createSignal<SortOrder>(
      String(api.kv.get(SETTING_KEYS.order, "desc")) === "asc" ? "asc" : "desc",
    )
    const [scrollMode, setScrollMode] = createSignal<ScrollMode>(
      String(api.kv.get(SETTING_KEYS.scrollMode, "wheel")) === "click" ? "click" : "wheel",
    )
    const [open, setOpen] = createSignal<boolean>((api.kv.get(SETTING_KEYS.open, true) as boolean) !== false)
    const [showEntryTime, setShowEntryTime] = createSignal<boolean>((api.kv.get(SETTING_KEYS.showEntryTime, true) as boolean) !== false)
    const [showEntryCwd, setShowEntryCwd] = createSignal<boolean>((api.kv.get(SETTING_KEYS.showEntryCwd, false) as boolean) === true)
    const [showEntryExit, setShowEntryExit] = createSignal<boolean>((api.kv.get(SETTING_KEYS.showEntryExit, true) as boolean) !== false)
    const [showSubagents, setShowSubagents] = createSignal<boolean>((api.kv.get(SETTING_KEYS.showSubagents, true) as boolean) !== false)
    const [border, setBorder] = createSignal<boolean>((api.kv.get(SETTING_KEYS.border, true) as boolean) !== false)
    const [showFooter, setShowFooter] = createSignal<boolean>((api.kv.get(SETTING_KEYS.showFooter, false) as boolean) === true)
    const storedTimeFormat = String(api.kv.get(SETTING_KEYS.timeFormat, "short"))
    const [timeFormat, setTimeFormat] = createSignal<TimeFormat>(
      (TIME_FORMATS as readonly string[]).includes(storedTimeFormat) ? (storedTimeFormat as TimeFormat) : "short",
    )
    const [notifyOnFinish, setNotifyOnFinish] = createSignal<boolean>((api.kv.get(SETTING_KEYS.notifyOnFinish, true) as boolean) !== false)
    const [notifyThresholdMs, setNotifyThresholdMs] = createSignal<number>(Number(api.kv.get(SETTING_KEYS.notifyThreshold, "30000")) || 30000)

    const signals: SharedSignals = {
      lang, setLang, maxEntries, setMaxEntries, sortOrder, setSortOrder, scrollMode, setScrollMode,
      open, setOpen,
      showEntryTime, setShowEntryTime,
      showEntryCwd, setShowEntryCwd,
      showEntryExit, setShowEntryExit,
      showSubagents, setShowSubagents,
      border, setBorder,
      showFooter, setShowFooter,
      timeFormat, setTimeFormat,
      notifyOnFinish, setNotifyOnFinish,
      notifyThresholdMs, setNotifyThresholdMs,
      sessionId: "",
    }

    // Command layer goes in the app slot: slash commands must stay available when the sidebar is hidden (see CommandRoot)
    context.ui.slot({
      append: "app",
      render: () => (
        <CommandRoot context={context} api={api} signals={signals} />
      ),
    })

    // Sidebar panel (prepend: sits above the existing sidebar content, e.g. Context)
    context.ui.slot({
      prepend: "sidebar.content",
      render: (props) => {
        signals.sessionId = String(props.sessionID ?? "")
        return (
          <PluginRoot
            api={api}
            theme={mapTheme(context.theme)}
            signals={signals}
            sessionID={String(props.sessionID ?? "")}
          />
        )
      },
    })

    // Prompt footer status: "N shell" while commands are running
    // (toggle: settings menu or /shell-magazine-footer-status).
    const t = createT(() => signals.lang())
    context.ui.slot({
      append: "prompt.footer.status",
      render: (props) => (
        <FooterStatus
          api={api}
          theme={mapTheme(context.theme)}
          sessionID={String(props.sessionID ?? signals.sessionId ?? "")}
          enabled={signals.showFooter}
          showSubagents={signals.showSubagents}
          label={() => t("footer.shell")}
        />
      ),
    })
  },
}

export default mod
