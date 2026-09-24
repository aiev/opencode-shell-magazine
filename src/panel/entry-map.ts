import type { ShellEntry } from "../core/types"
import { isTerminal } from "./shell-data"

/** Entry storage key: shellID first, then id. */
export function entryKey(entry: ShellEntry): string {
  return entry.shellID ?? entry.id
}

/**
 * Find the existing key for the same shell in the map.
 * Event entries (sh_…) and scan entries (tool:call_…) may arrive in either order:
 * the same shellID means the same entry.
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

/** Merge the same entry: terminal state wins (out-of-order events / restart fallback); fields are merged as a union. */
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

/** Merge new entries into an existing list (dedupe by shell + merge). */
export function mergeShellEntries(prev: ShellEntry[], next: ShellEntry[]): ShellEntry[] {
  const map = new Map<string, ShellEntry>(prev.map((e) => [entryKey(e), e]))
  for (const entry of next) {
    const key = findShellEntryKey(map, entry) ?? entryKey(entry)
    const existing = map.get(key)
    map.set(key, existing ? mergeShellEntry(existing, entry) : entry)
  }
  return [...map.values()]
}
