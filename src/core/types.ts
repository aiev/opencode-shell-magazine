import type { LangCode } from "../i18n"

export type Lang = LangCode
export type SortOrder = "desc" | "asc"
export type ScrollMode = "wheel" | "click"
/** How elapsed time is rendered in the sidebar (see TIME_FORMAT_SAMPLES). */
export type TimeFormat = "short" | "decimal" | "clock" | "compact" | "seconds"

/** 命令状态：running 为进行中；其余为宿主上报的终态（或工具失败）。 */
export type ShellStatus = "running" | "exited" | "timeout" | "killed" | "error"

export interface ShellEntry {
  /** 稳定主键：优先 shellID，其次 tool call id / 消息 id。 */
  id: string
  /** 宿主的 shell 记录 id（sh_…）——kill / 读输出都靠它。 */
  shellID?: string
  /** 来源：agent（工具调用）或 user（会话内 !命令）。 */
  source: "agent" | "user"
  command: string
  cwd?: string
  shell?: string
  pid?: number
  /** 后台输出的落盘文件（~/.local/share/opencode/shell/…/*.out）。 */
  file?: string
  timeout?: number
  status: ShellStatus
  exit?: number
  startedAt: number
  endedAt?: number
  output?: string
  truncated?: boolean
  /** 已完成并发出过 attention 通知。 */
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
