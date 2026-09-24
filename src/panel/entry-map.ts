import type { ShellEntry } from "../core/types"
import { isTerminal } from "./shell-data"

/** 条目的存储键：优先 shellID，其次 id。 */
export function entryKey(entry: ShellEntry): string {
  return entry.shellID ?? entry.id
}

/**
 * 在 map 中查找同一 shell 的已有键。
 * 事件条目（sh_…）与扫描条目（tool:call_…）可能先后来到：
 * shellID 相同即视为同一条。
 */
export function findShellEntryKey(map: Map<string, ShellEntry>, next: ShellEntry): string | undefined {
  if (next.shellID && map.has(next.shellID)) return next.shellID
  if (map.has(next.id)) return next.id
  if (next.shellID) {
    for (const [k, e] of map) if (e.shellID === next.shellID) return k
  }
  for (const [k, e] of map) if (e.id === next.id) return k
  return undefined
}

/** 合并同一条目：终态优先（事件乱序/重启兜底），字段取并集。 */
export function mergeShellEntry(prev: ShellEntry, next: ShellEntry): ShellEntry {
  const terminalWins = isTerminal(prev.status) && !isTerminal(next.status)
  const primary = terminalWins ? prev : next
  const secondary = terminalWins ? next : prev
  return {
    ...secondary,
    ...primary,
    id: primary.id || secondary.id,
    source: prev.source === "user" || next.source === "user" ? "user" : "agent",
    shellID: primary.shellID ?? secondary.shellID,
    command: primary.command || secondary.command,
    cwd: primary.cwd ?? secondary.cwd,
    shell: primary.shell ?? secondary.shell,
    pid: primary.pid ?? secondary.pid,
    file: primary.file ?? secondary.file,
    timeout: primary.timeout ?? secondary.timeout,
    exit: primary.exit ?? secondary.exit,
    startedAt: primary.startedAt || secondary.startedAt,
    endedAt: primary.endedAt ?? secondary.endedAt,
    output: primary.output ?? secondary.output,
    truncated: primary.truncated ?? secondary.truncated,
    notified: primary.notified ?? secondary.notified,
    error: primary.error ?? secondary.error,
  }
}

/** 把新条目并入已有列表（按 shell 去重 + 合并）。 */
export function mergeShellEntries(prev: ShellEntry[], next: ShellEntry[]): ShellEntry[] {
  const map = new Map<string, ShellEntry>(prev.map((e) => [entryKey(e), e]))
  for (const entry of next) {
    const key = findShellEntryKey(map, entry) ?? entryKey(entry)
    const existing = map.get(key)
    map.set(key, existing ? mergeShellEntry(existing, entry) : entry)
  }
  return [...map.values()]
}
