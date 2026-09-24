import type { Context, KeymapCommand } from "./context"
import type { ShellPanelApi } from "../panel/api"
import type { Lang, ScrollMode, SharedSignals, SortOrder, TimeFormat } from "../core/types"
import { TIME_FORMATS, TIME_FORMAT_SAMPLES } from "../core/format"
import { SETTING_KEYS } from "../core/kv"
import { LANG_META, createT } from "../i18n"
import { PLUGIN_VERSION } from "../_version"
import { clearTick, setClearTick } from "../panel/store"
import { MAX_OPTIONS, THRESHOLDS, openSettingsMenu, thresholdLabel } from "./settings-menu"

/** Command layer (registered in the app slot: slash commands stay available when the sidebar is hidden). */
export function makeCommands(context: Context, api: ShellPanelApi, signals: SharedSignals): KeymapCommand[] {
  const t = createT(() => signals.lang())
  const onOff = (v: boolean) => (v ? t("settings.on") : t("settings.off"))
  const toast = (message: string) => context.ui.toast.show({ message })
  const kv = api.kv

  /** One slash command per boolean setting (same handlers as the native menu). */
  const toggle = (opts: {
    slash: string
    title: string
    key: string
    get: () => boolean
    set: (v: boolean) => void
    label: string
  }): KeymapCommand => ({
    id: `opencode-shell-magazine.shell.${opts.slash}`,
    title: `Shell Magazine: ${opts.title}`,
    description: `Toggle ${opts.label}`,
    slash: { name: opts.slash },
    palette: true,
    run: () => {
      const v = !opts.get()
      opts.set(v)
      void kv.set(opts.key, v)
      toast(`${opts.label}: ${onOff(v)}`)
    },
  })

  /** One slash command per enumerated setting (select dialog). */
  const choose = <T>(opts: {
    slash: string
    title: string
    label: string
    options: readonly { title: string; value: T }[]
    current: () => T
    apply: (v: T) => void
  }): KeymapCommand => ({
    id: `opencode-shell-magazine.shell.${opts.slash}`,
    title: `Shell Magazine: ${opts.title}`,
    description: `Choose ${opts.label}`,
    slash: { name: opts.slash },
    palette: true,
    run: async () => {
      const picked = await context.ui.dialog.select<T>({
        title: opts.label,
        options: opts.options,
        current: opts.current(),
      })
      if (picked !== undefined) opts.apply(picked)
    },
  })

  const langLabel = () => LANG_META.find((m) => m.code === signals.lang())?.label ?? signals.lang()

  return [
    {
      id: "opencode-shell-magazine.shell.settings",
      title: "Shell Magazine: Settings Menu",
      description: "Open the interactive settings menu (Esc to close)",
      slash: { name: "shell-magazine" },
      palette: true,
      run: () => {
        openSettingsMenu(context, api, signals)
      },
    },
    {
      id: "opencode-shell-magazine.shell.config",
      title: "Shell Magazine: Configuration",
      description: "Show the current plugin settings",
      slash: { name: "shell-magazine-config" },
      palette: true,
      run: () => {
        const lines = [
          `${t("settings.lang")}: ${langLabel()}`,
          `${t("settings.maxEntries")}: ${signals.maxEntries()}`,
          `${t("settings.order")}: ${signals.sortOrder() === "asc" ? t("order.asc") : t("order.desc")}`,
          `${t("settings.scroll")}: ${signals.scrollMode() === "click" ? t("scroll.click") : t("scroll.wheel")}`,
          `${t("settings.timeFormat")}: ${TIME_FORMAT_SAMPLES[signals.timeFormat()]}`,
          `${t("settings.showTime")}: ${onOff(signals.showEntryTime())}`,
          `${t("settings.showCwd")}: ${onOff(signals.showEntryCwd())}`,
          `${t("settings.showExit")}: ${onOff(signals.showEntryExit())}`,
          `${t("settings.showSubagents")}: ${onOff(signals.showSubagents())}`,
          `${t("settings.showFooter")}: ${onOff(signals.showFooter())}`,
          `${t("settings.border")}: ${onOff(signals.border())}`,
          `${t("settings.notify")}: ${onOff(signals.notifyOnFinish())}`,
          `${t("settings.notifyThreshold")}: ${thresholdLabel(signals.notifyThresholdMs())}`,
        ]
        context.ui.toast.show({ title: `opencode-shell-magazine v${PLUGIN_VERSION}`, message: lines.join("\n") })
      },
    },
    {
      id: "opencode-shell-magazine.shell.clear",
      title: "Shell Magazine: Clear Finished",
      description: "Remove finished shell commands from the panel",
      slash: { name: "shell-magazine-clear" },
      palette: true,
      run: async () => {
        const ok = await context.ui.dialog.confirm({
          title: t("confirm.clear.title"),
          message: t("confirm.clear.message"),
        })
        if (ok) setClearTick(clearTick() + 1)
      },
    },
    {
      id: "opencode-shell-magazine.shell.version",
      title: "Shell Magazine: Version",
      description: "Show plugin version",
      slash: { name: "shell-magazine-version" },
      palette: true,
      run: () => {
        toast(`opencode-shell-magazine v${PLUGIN_VERSION}`)
      },
    },
    choose<Lang>({
      slash: "shell-magazine-lang",
      title: "Language",
      label: t("settings.lang"),
      options: LANG_META.map((m) => ({ title: m.label, value: m.code })),
      current: signals.lang,
      apply: (v) => {
        signals.setLang(v)
        void kv.set(SETTING_KEYS.lang, v)
      },
    }),
    choose<number>({
      slash: "shell-magazine-max",
      title: "Max Entries",
      label: t("settings.maxEntries"),
      options: MAX_OPTIONS.map((n) => ({ title: String(n), value: n })),
      current: signals.maxEntries,
      apply: (v) => {
        signals.setMaxEntries(v)
        void kv.set(SETTING_KEYS.maxEntries, v)
      },
    }),
    choose<SortOrder>({
      slash: "shell-magazine-order",
      title: "Sort Order",
      label: t("settings.order"),
      options: [
        { title: t("order.desc"), value: "desc" },
        { title: t("order.asc"), value: "asc" },
      ],
      current: signals.sortOrder,
      apply: (v) => {
        signals.setSortOrder(v)
        void kv.set(SETTING_KEYS.order, v)
      },
    }),
    choose<ScrollMode>({
      slash: "shell-magazine-scroll",
      title: "Scroll Mode",
      label: t("settings.scroll"),
      options: [
        { title: t("scroll.wheel"), value: "wheel" },
        { title: t("scroll.click"), value: "click" },
      ],
      current: signals.scrollMode,
      apply: (v) => {
        signals.setScrollMode(v)
        void kv.set(SETTING_KEYS.scrollMode, v)
      },
    }),
    choose<TimeFormat>({
      slash: "shell-magazine-time-format",
      title: "Time Format",
      label: t("settings.timeFormat"),
      options: TIME_FORMATS.map((f) => ({ title: TIME_FORMAT_SAMPLES[f], value: f })),
      current: signals.timeFormat,
      apply: (v) => {
        signals.setTimeFormat(v)
        void kv.set(SETTING_KEYS.timeFormat, v)
      },
    }),
    choose<number>({
      slash: "shell-magazine-threshold",
      title: "Notification Threshold",
      label: t("settings.notifyThreshold"),
      options: THRESHOLDS.map((ms) => ({ title: thresholdLabel(ms), value: ms })),
      current: signals.notifyThresholdMs,
      apply: (v) => {
        signals.setNotifyThresholdMs(v)
        void kv.set(SETTING_KEYS.notifyThreshold, v)
      },
    }),
    toggle({
      slash: "shell-magazine-show-time",
      title: "Toggle Elapsed Time",
      key: SETTING_KEYS.showEntryTime,
      get: signals.showEntryTime,
      set: signals.setShowEntryTime,
      label: t("settings.showTime"),
    }),
    toggle({
      slash: "shell-magazine-show-cwd",
      title: "Toggle Working Directory",
      key: SETTING_KEYS.showEntryCwd,
      get: signals.showEntryCwd,
      set: signals.setShowEntryCwd,
      label: t("settings.showCwd"),
    }),
    toggle({
      slash: "shell-magazine-show-exit",
      title: "Toggle Exit Code",
      key: SETTING_KEYS.showEntryExit,
      get: signals.showEntryExit,
      set: signals.setShowEntryExit,
      label: t("settings.showExit"),
    }),
    toggle({
      slash: "shell-magazine-show-subagents",
      title: "Toggle Subagent Commands",
      key: SETTING_KEYS.showSubagents,
      get: signals.showSubagents,
      set: signals.setShowSubagents,
      label: t("settings.showSubagents"),
    }),
    toggle({
      slash: "shell-magazine-footer-status",
      title: "Toggle Footer Indicator",
      key: SETTING_KEYS.showFooter,
      get: signals.showFooter,
      set: signals.setShowFooter,
      label: t("settings.showFooter"),
    }),
    toggle({
      slash: "shell-magazine-border",
      title: "Toggle Panel Border",
      key: SETTING_KEYS.border,
      get: signals.border,
      set: signals.setBorder,
      label: t("settings.border"),
    }),
    toggle({
      slash: "shell-magazine-notify",
      title: "Toggle Finish Notification",
      key: SETTING_KEYS.notifyOnFinish,
      get: signals.notifyOnFinish,
      set: signals.setNotifyOnFinish,
      label: t("settings.notify"),
    }),
  ]
}
