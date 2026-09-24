import type { Context } from "./context"
import type { ShellPanelApi } from "../panel/api"
import type { Lang, SharedSignals } from "../core/types"
import { SETTING_KEYS } from "../core/kv"
import { TIME_FORMATS, TIME_FORMAT_SAMPLES } from "../core/format"
import { LANG_META, createT } from "../i18n"
import { clearTick, setClearTick } from "../panel/store"

const nextTick = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

export const MAX_OPTIONS: readonly number[] = [5, 10, 20, 50]
const THRESHOLDS: readonly number[] = [10_000, 30_000, 60_000, 120_000, 300_000]
export const thresholdLabel = (ms: number) => (ms < 60_000 ? `${Math.round(ms / 1000)}s` : `${Math.round(ms / 60_000)}m`)
export { THRESHOLDS }

/**
 * Native settings menu: each selection takes effect immediately and is written back to KV,
 * then the menu reopens (the host closes the editor before the next select).
 */
export function openSettingsMenu(context: Context, api: ShellPanelApi, signals: SharedSignals): void {
  const t = createT(() => signals.lang())
  const onOff = (v: boolean) => (v ? t("settings.on") : t("settings.off"))
  const kv = api.kv

  const pickBool = (title: string, current: boolean): Promise<boolean | undefined> =>
    context.ui.dialog.select<boolean>({
      title,
      options: [
        { title: t("settings.on"), value: true },
        { title: t("settings.off"), value: false },
      ],
      current,
    })

  void (async () => {
    while (true) {
      const choice = await context.ui.dialog.select<string>({
        title: t("settings.title"),
        options: [
          { title: `${t("settings.lang")}: ${LANG_META.find((m) => m.code === signals.lang())?.label ?? signals.lang()}`, value: "lang" },
          { title: `${t("settings.maxEntries")}: ${signals.maxEntries()}`, value: "max" },
          { title: `${t("settings.order")}: ${signals.sortOrder() === "asc" ? t("order.asc") : t("order.desc")}`, value: "order" },
          { title: `${t("settings.scroll")}: ${signals.scrollMode() === "click" ? t("scroll.click") : t("scroll.wheel")}`, value: "scroll" },
          { title: `${t("settings.timeFormat")}: ${TIME_FORMAT_SAMPLES[signals.timeFormat()]}`, value: "timefmt" },
          { title: `${t("settings.showTime")}: ${onOff(signals.showEntryTime())}`, value: "showtime" },
          { title: `${t("settings.showCwd")}: ${onOff(signals.showEntryCwd())}`, value: "showcwd" },
          { title: `${t("settings.showExit")}: ${onOff(signals.showEntryExit())}`, value: "showexit" },
          { title: `${t("settings.showSubagents")}: ${onOff(signals.showSubagents())}`, value: "showsub" },
          { title: `${t("settings.showFooter")}: ${onOff(signals.showFooter())}`, value: "showfooter" },
          { title: `${t("settings.border")}: ${onOff(signals.border())}`, value: "border" },
          { title: `${t("settings.notify")}: ${onOff(signals.notifyOnFinish())}`, value: "notify" },
          { title: `${t("settings.notifyThreshold")}: ${thresholdLabel(signals.notifyThresholdMs())}`, value: "threshold" },
          { title: t("settings.clearFinished"), value: "clear" },
        ],
      })
      if (choice === undefined) return

      if (choice === "lang") {
        const picked = await context.ui.dialog.select<Lang>({
          title: t("settings.lang"),
          options: LANG_META.map((m) => ({ title: m.label, value: m.code })),
          current: signals.lang(),
        })
        if (picked !== undefined) {
          signals.setLang(picked)
          kv.set(SETTING_KEYS.lang, picked)
        }
      } else if (choice === "max") {
        const picked = await context.ui.dialog.select<number>({
          title: t("settings.maxEntries"),
          options: MAX_OPTIONS.map((n) => ({ title: String(n), value: n })),
          current: signals.maxEntries(),
        })
        if (picked !== undefined) {
          signals.setMaxEntries(picked)
          kv.set(SETTING_KEYS.maxEntries, picked)
        }
      } else if (choice === "order") {
        const picked = await context.ui.dialog.select<"desc" | "asc">({
          title: t("settings.order"),
          options: [
            { title: t("order.desc"), value: "desc" },
            { title: t("order.asc"), value: "asc" },
          ],
          current: signals.sortOrder(),
        })
        if (picked !== undefined) {
          signals.setSortOrder(picked)
          kv.set(SETTING_KEYS.order, picked)
        }
      } else if (choice === "scroll") {
        const picked = await context.ui.dialog.select<"wheel" | "click">({
          title: t("settings.scroll"),
          options: [
            { title: t("scroll.wheel"), value: "wheel" },
            { title: t("scroll.click"), value: "click" },
          ],
          current: signals.scrollMode(),
        })
        if (picked !== undefined) {
          signals.setScrollMode(picked)
          kv.set(SETTING_KEYS.scrollMode, picked)
        }
      } else if (choice === "timefmt") {
        const picked = await context.ui.dialog.select<(typeof TIME_FORMATS)[number]>({
          title: t("settings.timeFormat"),
          options: TIME_FORMATS.map((f) => ({ title: TIME_FORMAT_SAMPLES[f], value: f })),
          current: signals.timeFormat(),
        })
        if (picked !== undefined) {
          signals.setTimeFormat(picked)
          kv.set(SETTING_KEYS.timeFormat, picked)
        }
      } else if (choice === "showtime") {
        const picked = await pickBool(t("settings.showTime"), signals.showEntryTime())
        if (picked !== undefined) {
          signals.setShowEntryTime(picked)
          kv.set(SETTING_KEYS.showEntryTime, picked)
        }
      } else if (choice === "showcwd") {
        const picked = await pickBool(t("settings.showCwd"), signals.showEntryCwd())
        if (picked !== undefined) {
          signals.setShowEntryCwd(picked)
          kv.set(SETTING_KEYS.showEntryCwd, picked)
        }
      } else if (choice === "showexit") {
        const picked = await pickBool(t("settings.showExit"), signals.showEntryExit())
        if (picked !== undefined) {
          signals.setShowEntryExit(picked)
          kv.set(SETTING_KEYS.showEntryExit, picked)
        }
      } else if (choice === "showsub") {
        const picked = await pickBool(t("settings.showSubagents"), signals.showSubagents())
        if (picked !== undefined) {
          signals.setShowSubagents(picked)
          kv.set(SETTING_KEYS.showSubagents, picked)
        }
      } else if (choice === "showfooter") {
        const picked = await pickBool(t("settings.showFooter"), signals.showFooter())
        if (picked !== undefined) {
          signals.setShowFooter(picked)
          kv.set(SETTING_KEYS.showFooter, picked)
        }
      } else if (choice === "border") {
        const picked = await pickBool(t("settings.border"), signals.border())
        if (picked !== undefined) {
          signals.setBorder(picked)
          kv.set(SETTING_KEYS.border, picked)
        }
      } else if (choice === "notify") {
        const picked = await pickBool(t("settings.notify"), signals.notifyOnFinish())
        if (picked !== undefined) {
          signals.setNotifyOnFinish(picked)
          kv.set(SETTING_KEYS.notifyOnFinish, picked)
        }
      } else if (choice === "threshold") {
        const picked = await context.ui.dialog.select<number>({
          title: t("settings.notifyThreshold"),
          options: THRESHOLDS.map((ms) => ({ title: thresholdLabel(ms), value: ms })),
          current: signals.notifyThresholdMs(),
        })
        if (picked !== undefined) {
          signals.setNotifyThresholdMs(picked)
          kv.set(SETTING_KEYS.notifyThreshold, picked)
        }
      } else if (choice === "clear") {
        const ok = await context.ui.dialog.confirm({
          title: t("confirm.clear.title"),
          message: t("confirm.clear.message"),
        })
        if (ok) setClearTick(clearTick() + 1)
      }

      await nextTick()
    }
  })()
}
