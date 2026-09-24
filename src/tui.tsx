/** @jsxImportSource @opentui/solid */

import { createSignal } from "solid-js"
import type { Context, PluginModule } from "./v2/context"
import { createShellApi } from "./v2/adapter"
import { makeCommands } from "./v2/commands"
import { mapTheme } from "./v2/theme"
import { ShellPanel } from "./panel/ShellPanel"
import type { ShellPanelApi } from "./panel/api"
import type { Lang, SharedSignals, SortOrder, ScrollMode, TimeFormat } from "./core/types"
import { TIME_FORMATS } from "./core/format"
import { SETTING_KEYS } from "./core/kv"
import { LANG_META, detectLang } from "./i18n"

/** 命令层必须在 app 槽注册：侧栏隐藏时命令仍需可用。 */
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

/** 面板根组件：渲染 ShellPanel（命令层见 CommandRoot）。 */
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
      timeFormat={props.signals.timeFormat}
      notifyOnFinish={props.signals.notifyOnFinish}
      notifyThresholdMs={props.signals.notifyThresholdMs}
      sessionId={props.sessionID}
    />
  )
}

/**
 * V2 入口：setup 创建共享信号 + ShellPanelApi + 命令 layer + 侧边栏槽位。
 * 信号初始值从 KV 恢复；面板挂在 sidebar.content 底部（append）。
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
      timeFormat, setTimeFormat,
      notifyOnFinish, setNotifyOnFinish,
      notifyThresholdMs, setNotifyThresholdMs,
      sessionId: "",
    }

    // 命令层挂 app 槽：侧栏隐藏时斜杠命令仍需可用（见 CommandRoot）
    context.ui.slot({
      append: "app",
      render: () => (
        <CommandRoot context={context} api={api} signals={signals} />
      ),
    })

    // 侧边栏面板（append：排在其它侧栏内容之后）
    context.ui.slot({
      append: "sidebar.content",
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
  },
}

export default mod
