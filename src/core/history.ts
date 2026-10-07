import { readFile } from "node:fs/promises"
import { homedir } from "node:os"
import { join } from "node:path"
import { promisify } from "node:util"
import { gunzip } from "node:zlib"
import type { KVApi } from "./kv"
import type { SessionRecord, ShellEntry } from "./types"
import { entryKey, mergeShellEntries, sameShellEntry } from "../panel/entry-map"
import type { TextBlobs } from "./text-blobs"

const decompress = promisify(gunzip)
const PREFIX = "\u001fgzip1:"
const BLOB_PREFIX = "\u001fblob1:"
const TEXT_FIELDS = ["command", "output", "error"] as const

interface StoredRecord extends SessionRecord {
  version: 1 | 2
  initialized: boolean
}

interface Manifest {
  version: 3
  ref?: string
}

type StoredValue = Manifest | StoredRecord

export interface SessionHistory {
  load(sessionID: string): Promise<SessionRecord>
  save(sessionID: string, record: SessionRecord): Promise<void>
  output(sessionID: string, entryID: string): Promise<string | undefined>
  flush(): Promise<void>
}

export function sessionHistoryKey(sessionID: string): string {
  if (!/^[a-zA-Z0-9_-]+$/.test(sessionID)) throw new Error("Invalid session ID")
  return `shell_magazine.history.${sessionID}`
}

async function encodeText(text: string, blobs: TextBlobs, limit: number): Promise<string> {
  if (text.length <= limit && !text.startsWith(PREFIX) && !text.startsWith(BLOB_PREFIX)) return text
  return BLOB_PREFIX + await blobs.put(text)
}

async function decodeText(text: string, blobs: TextBlobs): Promise<string> {
  if (text.startsWith(BLOB_PREFIX)) return blobs.read(text.slice(BLOB_PREFIX.length))
  return text.startsWith(PREFIX)
    ? (await decompress(Buffer.from(text.slice(PREFIX.length), "base64"))).toString("utf8")
    : text
}

async function batches<T, R>(items: readonly T[], fn: (item: T) => Promise<R>): Promise<R[]> {
  const result: R[] = []
  for (let i = 0; i < items.length; i += 16) result.push(...await Promise.all(items.slice(i, i + 16).map(fn)))
  return result
}

function emptyRecord(): StoredRecord {
  return { version: 2, initialized: false, ts: 0, entries: [], scroll: 0, expanded: "" }
}

function storedRecord(raw: unknown): StoredRecord {
  if (raw === undefined) return emptyRecord()
  const record = raw as StoredRecord
  if (![1, 2].includes(record?.version) || !Array.isArray(record.entries)) throw new Error("Invalid shell history record")
  return record
}

function sameRecord(a: SessionRecord, b: SessionRecord): boolean {
  return a.scroll === b.scroll && a.expanded === b.expanded &&
    (a.clearedIds ?? []).join("\u0000") === (b.clearedIds ?? []).join("\u0000") &&
    a.entries.length === b.entries.length && a.entries.every((entry, i) => sameShellEntry(entry, b.entries[i]))
}

/** Host storage contains only a tiny revision pointer per session. Metadata and
 * large text live outside host reload. Updates use compare-and-swap under the
 * host lock: no async filesystem work is done inside its synchronous updater.
 * The legacy monolith is NEVER registered with host storage/live reload. */
export function createSessionHistory(
  kv: KVApi,
  blobs: TextBlobs,
  readLegacy: () => Promise<Record<string, SessionRecord>> = async () => ({}),
): SessionHistory {
  let legacy: Promise<Record<string, SessionRecord>> | undefined
  const initialized = new Map<string, Promise<void>>()
  const encoded = new WeakMap<ShellEntry, Promise<ShellEntry>>()
  const pending = new Set<Promise<unknown>>()
  const records = new Map<string, Promise<StoredRecord>>()

  const track = <T>(operation: Promise<T>): Promise<T> => {
    pending.add(operation)
    operation.then(() => pending.delete(operation), () => pending.delete(operation))
    return operation
  }
  const snapshot = (raw: unknown): StoredValue => {
    if (raw === undefined) return { version: 3 }
    if ((raw as Manifest)?.version === 3) {
      const ref = (raw as Manifest).ref
      if (ref !== undefined && !/^[a-f0-9]{64}$/.test(ref)) throw new Error("Invalid shell history reference")
      return { version: 3, ...(ref === undefined ? {} : { ref }) }
    }
    // Only needed once when upgrading an experimental inline shard.
    return JSON.parse(JSON.stringify(storedRecord(raw)))
  }
  const get = (sid: string) => snapshot(kv.get(sessionHistoryKey(sid), { version: 3 }))
  const readRecord = (value: StoredValue): Promise<StoredRecord> => {
    if (value.version !== 3) return Promise.resolve(value)
    if (!value.ref) return Promise.resolve(emptyRecord())
    let record = records.get(value.ref)
    if (!record) {
      const ref = value.ref
      record = blobs.read(ref).then((json) => storedRecord(JSON.parse(json)))
      records.set(ref, record)
      record.catch(() => records.delete(ref))
      if (records.size > 32) records.delete(records.keys().next().value!)
    }
    return record
  }
  const publish = async (record: StoredRecord): Promise<Manifest> => {
    const ref = await blobs.put(JSON.stringify(record))
    records.set(ref, Promise.resolve(record))
    if (records.size > 32) records.delete(records.keys().next().value!)
    return { version: 3, ref }
  }
  const compareAndSwap = async (sid: string, expected: StoredValue, next: Manifest): Promise<boolean> => {
    const key = sessionHistoryKey(sid)
    const token = JSON.stringify(expected)
    let swapped = false
    const apply = (raw: unknown) => {
      const current = snapshot(raw)
      if (JSON.stringify(current) !== token) return current
      swapped = true
      return next
    }
    if (!kv.update) throw new Error("Atomic shell history storage is unavailable")
    await kv.update(key, apply)
    return swapped
  }
  const encodeEntry = (entry: ShellEntry): Promise<ShellEntry> => {
    let result = encoded.get(entry)
    if (!result) {
      result = (async () => {
        const next = { ...entry, hasOutput: entry.hasOutput || entry.output !== undefined }
        for (const field of TEXT_FIELDS) {
          const value = entry[field]
          if (value !== undefined) next[field] = await encodeText(value, blobs, field === "output" ? 64 : 256)
        }
        return next
      })()
      encoded.set(entry, result)
    }
    return result
  }
  const ensure = (sid: string): Promise<void> => {
    const value = get(sid)
    if (value.version === 3 && value.ref) return Promise.resolve()
    const existing = initialized.get(sid)
    if (existing) return existing
    const operation = (async () => {
      for (let attempt = 0; attempt < 32; attempt++) {
        const expected = get(sid)
        if (expected.version === 3 && expected.ref) return
        const current = await readRecord(expected)
        let initial: SessionRecord
        let entries: ShellEntry[]
        if (current.initialized) {
          initial = current
          if (current.version === 2) entries = current.entries
          else {
            const decoded = await batches(current.entries, async (entry) => {
              const next = { ...entry }
              for (const field of TEXT_FIELDS) {
                if (entry[field] !== undefined) next[field] = await decodeText(entry[field]!, blobs)
              }
              return next
            })
            entries = await batches(decoded, encodeEntry)
          }
        } else {
          if (!legacy) {
            legacy = readLegacy()
            legacy.catch(() => { legacy = undefined })
          }
          const source = await legacy
          initial = Object.hasOwn(source, sid) ? source[sid] : emptyRecord()
          entries = await batches(initial.entries, encodeEntry)
        }
        const next = await publish({ ...initial, entries, version: 2, initialized: true })
        if (await compareAndSwap(sid, expected, next)) return
      }
      throw new Error("Shell history migration contention; original data was left intact")
    })()
    initialized.set(sid, operation)
    operation.catch(() => initialized.delete(sid))
    return operation
  }

  return {
    load: (sid) => track((async () => {
      await ensure(sid)
      const current = await readRecord(get(sid))
      const record = { ...current, clearedIds: current.clearedIds?.slice(), entries: current.entries.map((entry) => ({ ...entry })) }
      const entries = await batches(record.entries, async (entry) => {
        const next = { ...entry, command: await decodeText(entry.command, blobs) }
        if (entry.error !== undefined) next.error = await decodeText(entry.error, blobs)
        // Preserve the payload in storage, not in the reactive/rendered list.
        delete next.output
        return next
      })
      return { ...record, entries }
    })()),
    save: (sid, record) => track((async () => {
      await ensure(sid)
      const entries = await batches(record.entries, encodeEntry)
      const merge = (latest: StoredRecord): StoredRecord => {
        const clearedIds = [...new Set([...(latest.clearedIds ?? []), ...(record.clearedIds ?? [])])].sort()
        const cleared = new Set(clearedIds)
        const merged = mergeShellEntries(latest.entries, entries)
          .filter((entry) => !cleared.has(entryKey(entry)) && !cleared.has(entry.id))
        const next: StoredRecord = {
          version: 2, initialized: true, ts: record.ts, entries: merged,
          scroll: record.scroll, expanded: record.expanded, clearedIds,
        }
        return sameRecord(latest, next) ? latest : next
      }
      // An unchanged poll/scan must not trigger a disk write and global host reload.
      for (let attempt = 0; attempt < 32; attempt++) {
        const expected = get(sid)
        const current = await readRecord(expected)
        const next = merge(current)
        if (next === current) return
        if (await compareAndSwap(sid, expected, await publish(next))) return
      }
      throw new Error("Shell history write contention; original data was left intact")
    })()),
    output: (sid, entryID) => track((async () => {
      await ensure(sid)
      const entries = (await readRecord(get(sid))).entries
      const entry = entries.find((item) => item.id === entryID) ?? entries.find((item) => entryKey(item) === entryID)
      return entry?.output === undefined ? undefined : decodeText(entry.output, blobs)
    })()),
    flush: async () => {
      while (pending.size > 0) {
        const results = await Promise.allSettled([...pending])
        const errors = results.filter((result) => result.status === "rejected").map((result) => result.reason)
        if (errors.length) throw new AggregateError(errors, "Shell history writes failed")
      }
    },
  }
}

/** Read-only migration input. Keep the original file intact for backup/rollback
 * and for older TUIs that may still be using it during a rolling upgrade. */
export function legacyHistoryReader(channel: string, file?: string): () => Promise<Record<string, SessionRecord>> {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(channel) || channel === "." || channel === "..") {
    throw new Error("Invalid OpenCode channel")
  }
  const source = file ?? join(process.env.XDG_STATE_HOME || join(homedir(), ".local", "state"),
    "opencode", channel, "tui", "plugin.opencode-shell-magazine.shell_magazine.shell_magazine.session_data.json")
  return async () => {
    let text: string
    try { text = await readFile(source, "utf8") } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return {}
      throw error
    }
    const wrapper = JSON.parse(text)
    const records = JSON.parse(String(wrapper.value))
    if (!records || typeof records !== "object" || Array.isArray(records)) throw new Error("Invalid legacy shell history")
    for (const record of Object.values(records)) {
      if (!record || !Array.isArray((record as SessionRecord).entries)) throw new Error("Invalid legacy shell session")
    }
    return records
  }
}
