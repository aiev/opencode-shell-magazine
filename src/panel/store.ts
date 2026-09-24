import { createSignal } from "solid-js"
import type { ShellEntry } from "../core/types"

/** Module-level cache: entry state is stored per session and is not cleared when the current view changes. */
export const globalEntryCache = new Map<string, Map<string, ShellEntry>>()

/** Module-level refresh signal: incremented after an external clear (e.g. a slash command); the component's scan depends on it to rescan. */
export const [clearTick, setClearTick] = createSignal(0)
