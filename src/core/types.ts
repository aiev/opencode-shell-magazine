import type { LangCode } from "../i18n"

export type Lang = LangCode
export type SortOrder = "desc" | "asc"
export type ScrollMode = "wheel" | "click"
/** How elapsed time is rendered in the sidebar (see TIME_FORMAT_SAMPLES). */
export type TimeFormat = "short" | "decimal" | "clock" | "compact" | "seconds"

/** Command status: running means in progress; the others are terminal states reported by the host (or tool failure). */
export type ShellStatus = "running" | "exited" | "timeout" | "killed" | "error"

export interface ShellEntry {
  /** Stable primary key: shellID first, then tool call id / message id. */
  id: string
  /** Host shell record id (sh_…) — used for both kill and output reads. */
  shellID?: string
  /** Origin: agent (tool call) or user (in-session !command). */
  source: "agent" | "user"
  command: string
  cwd?: string
  shell?: string
  pid?: number
  /** On-disk file for background output (~/.local/share/opencode/shell/…/*.out). */
  file?: string
  timeout?: number
  status: ShellStatus
  exit?: number
  startedAt: number
  endedAt?: number
  output?: string
  truncated?: boolean
  /** Finished, and an attention notification has already been sent. */
  notified?: boolean
  error?: string
}

export interface SessionRecord {
  ts: number
  entries: ShellEntry[]
  scroll: number
  expanded: string
  clearedIds?: string[]
}

export interface SharedSignals {
  lang: () => Lang
  setLang: (l: Lang) => void
  maxEntries: () => number
  setMaxEntries: (n: number) => void
  sortOrder: () => SortOrder
  setSortOrder: (o: SortOrder) => void
  scrollMode: () => ScrollMode
  setScrollMode: (m: ScrollMode) => void
  open: () => boolean
  setOpen: (v: boolean) => void
  showEntryTime: () => boolean
  setShowEntryTime: (v: boolean) => void
  showEntryCwd: () => boolean
  setShowEntryCwd: (v: boolean) => void
  showEntryExit: () => boolean
  setShowEntryExit: (v: boolean) => void
  timeFormat: () => TimeFormat
  setTimeFormat: (f: TimeFormat) => void
  notifyOnFinish: () => boolean
  setNotifyOnFinish: (v: boolean) => void
  notifyThresholdMs: () => number
  setNotifyThresholdMs: (n: number) => void
  sessionId: string
}
