import assert from "node:assert/strict"
import test from "node:test"
import { mkdtemp, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createSessionHistory as createHistory, legacyHistoryReader, sessionHistoryKey } from "../src/core/history"
import { createHash } from "node:crypto"
import type { KVApi } from "../src/core/kv"
import { SESSION_DATA_KEY } from "../src/core/kv"
import { gzipSync } from "node:zlib"
import type { SessionRecord, ShellEntry } from "../src/core/types"

function storage() {
  const data = new Map<string, unknown>()
  const reads: string[] = []
  const writes: string[] = []
  let queue = Promise.resolve()
  const kv: KVApi = {
    get: (key, fallback) => { reads.push(key); return data.get(key) ?? fallback },
    set: (key, value) => { writes.push(key); data.set(key, structuredClone(value)) },
    update: (key, updater) => {
      const next = queue.then(() => {
        writes.push(key)
        data.set(key, structuredClone(updater(structuredClone(data.get(key)))))
      })
      queue = next.catch(() => {})
      return next
    },
  }
  return { kv, data, reads, writes }
}

const entry = (id: string, patch: Partial<ShellEntry> = {}): ShellEntry => ({
  id, source: "agent", command: "echo ok", status: "exited", startedAt: 1, endedAt: 2, ...patch,
})
const record = (entries: ShellEntry[], patch: Partial<SessionRecord> = {}): SessionRecord => ({
  ts: 1, entries, scroll: 0, expanded: "", ...patch,
})

const texts = new Map<string, string>()
function createSessionHistory(kv: KVApi, legacy?: () => Promise<Record<string, SessionRecord>>) {
  return createHistory(kv, {
    put: async (text) => {
      const hash = createHash("sha256").update(JSON.stringify(text)).digest("hex")
      texts.set(hash, text)
      return hash
    },
    read: async (hash) => {
      const text = texts.get(hash)
      if (text === undefined) throw new Error("Missing text blob")
      return text
    },
  }, legacy)
}

test("migrates only the requested session, without subscribing to the legacy monolith", async () => {
  const { kv, reads, data } = storage()
  let migrations = 0
  const legacy = { ses_a: record([entry("a")]), ses_b: record([entry("b")]) }
  const history = createSessionHistory(kv, async () => { migrations++; return legacy })
  assert.equal((await history.load("ses_a")).entries[0].id, "a")
  assert.equal(data.size, 1)
  assert.equal(reads.includes(SESSION_DATA_KEY), false)
  assert.equal((await history.load("ses_b")).entries[0].id, "b")
  assert.equal(migrations, 1)
  assert.equal(data.size, 2)
  assert.deepEqual(legacy.ses_a, record([entry("a")]))
})

test("large commands round-trip; large output stays compressed until requested", async () => {
  const { kv, data } = storage()
  const command = "printf 'hello world'\n".repeat(5000)
  const output = "long structured output line\n".repeat(10000)
  const history = createSessionHistory(kv, async () => ({ ses_a: record([entry("a", { command, output })]) }))
  const loaded = await history.load("ses_a")
  assert.equal(loaded.entries[0].command, command)
  assert.equal(loaded.entries[0].output, undefined)
  assert.equal(loaded.entries[0].hasOutput, true)
  assert.equal(await history.output("ses_a", "a"), output)
  assert.ok(JSON.stringify(data.get(sessionHistoryKey("ses_a"))).length < 10000)
  await history.save("ses_a", loaded)
  assert.equal(await history.output("ses_a", "a"), output, "saving metadata must not remove lazy output")
})

test("literal compression prefixes and Unicode remain exact", async () => {
  const history = createSessionHistory(storage().kv)
  const command = "\u001fgzip1:literal command"
  const output = "你好 🚀 ação\n".repeat(2000)
  await history.save("ses_a", record([entry("a", { command, output })]))
  assert.equal((await history.load("ses_a")).entries[0].command, command)
  assert.equal(await history.output("ses_a", "a"), output)
})

test("unchanged snapshots and timestamps do not write or trigger host reloads", async () => {
  const { kv, writes } = storage()
  const history = createSessionHistory(kv)
  await history.save("ses_a", record([entry("a", { output: "saved" })]))
  const loaded = await history.load("ses_a")
  const before = writes.length
  for (let i = 0; i < 20; i++) await history.save("ses_a", { ...loaded, ts: Date.now() + i })
  assert.equal(writes.length, before)
})

test("two TUIs initialize and merge the same session atomically", async () => {
  const { kv } = storage()
  const initial = async () => ({ ses_a: record([entry("old")]) })
  const one = createSessionHistory(kv, initial)
  const two = createSessionHistory(kv, initial)
  await Promise.all([
    one.save("ses_a", record([entry("one")])),
    two.save("ses_a", record([entry("two")])),
  ])
  assert.deepEqual((await one.load("ses_a")).entries.map((item) => item.id).sort(), ["old", "one", "two"])
})

test("stale running snapshots cannot resurrect cleared entries or terminal state", async () => {
  const { kv } = storage()
  const one = createSessionHistory(kv)
  const two = createSessionHistory(kv)
  await one.save("ses_a", record([entry("a"), entry("b", { notified: true })]))
  const stale = record([entry("a", { status: "running", endedAt: undefined }), entry("b", { status: "running", notified: false })])
  await one.save("ses_a", record([], { clearedIds: ["a"] }))
  await two.save("ses_a", stale)
  const loaded = await one.load("ses_a")
  assert.deepEqual(loaded.entries.map((item) => item.id), ["b"])
  assert.equal(loaded.entries[0].status, "exited")
  assert.equal(loaded.entries[0].notified, true)
})

test("legacy migration is read-only and malformed history is never overwritten", async () => {
  const directory = await mkdtemp(join(tmpdir(), "shell-history-"))
  const file = join(directory, "legacy.json")
  const text = JSON.stringify({ value: JSON.stringify({ ses_a: record([entry("a", { output: "original" })]) }) })
  await writeFile(file, text)
  const history = createSessionHistory(storage().kv, legacyHistoryReader("latest", file))
  await history.load("ses_a")
  assert.equal(await readFile(file, "utf8"), text)
  await writeFile(file, "broken")
  const { kv, writes } = storage()
  const broken = createSessionHistory(kv, legacyHistoryReader("latest", file))
  await assert.rejects(broken.save("ses_b", record([entry("b")])))
  assert.equal(writes.length, 0)
  assert.equal(await readFile(file, "utf8"), "broken")
})

test("invalid session/channel IDs cannot escape storage directories", () => {
  assert.throws(() => sessionHistoryKey("../ses_a"))
  assert.throws(() => legacyHistoryReader(".."))
})

test("flush waits for compression and pending history writes", async () => {
  const { kv } = storage()
  const history = createSessionHistory(kv)
  const saving = history.save("ses_a", record([entry("a", { output: "data\n".repeat(20000) })]))
  await history.flush()
  await saving
  assert.equal(await history.output("ses_a", "a"), "data\n".repeat(20000))
})

test("output lookup prefers exact entry IDs when historical aliases overlap", async () => {
  const history = createSessionHistory(storage().kv, async () => ({
    ses_a: record([
      entry("tool:a", { shellID: "sh_a", output: "tool output" }),
      entry("sh_a", { shellID: "sh_a", output: "registry output" }),
    ]),
  }))
  await history.load("ses_a")
  assert.equal(await history.output("ses_a", "tool:a"), "tool output")
  assert.equal(await history.output("ses_a", "sh_a"), "registry output")
})

test("a failed legacy read can be retried without losing the original record", async () => {
  let attempts = 0
  const history = createSessionHistory(storage().kv, async () => {
    if (++attempts === 1) throw new Error("Temporary read failure")
    return { ses_a: record([entry("a")]) }
  })
  await assert.rejects(history.load("ses_a"))
  assert.equal((await history.load("ses_a")).entries[0].id, "a")
})

test("inline-compressed experimental shards upgrade to external payload references", async () => {
  const { kv, data } = storage()
  const output = "stored output\n".repeat(20000)
  data.set(sessionHistoryKey("ses_a"), {
    ...record([entry("a", { output: "\u001fgzip1:" + gzipSync(output).toString("base64"), hasOutput: true })]),
    version: 1, initialized: true,
  })
  const history = createSessionHistory(kv)
  await history.load("ses_a")
  assert.equal((data.get(sessionHistoryKey("ses_a")) as any).version, 3)
  assert.ok(JSON.stringify(data.get(sessionHistoryKey("ses_a"))).length < 1000)
  assert.equal(await history.output("ses_a", "a"), output)
})

test("even thousands of entries leave only a tiny pointer in host live-reload storage", async () => {
  const { kv, data } = storage()
  const history = createSessionHistory(kv)
  const entries = Array.from({ length: 2000 }, (_, i) => entry(`entry_${i}`, { output: "large result\n".repeat(100) }))
  await history.save("ses_a", record(entries))
  assert.ok(JSON.stringify(data.get(sessionHistoryKey("ses_a"))).length < 100)
  const restarted = createSessionHistory(kv, async () => { throw new Error("Legacy must not be reread") })
  assert.equal((await restarted.load("ses_a")).entries.length, 2000)
  assert.equal(await restarted.output("ses_a", "entry_1999"), "large result\n".repeat(100))
})

test("failed payload publication cannot advance the durable revision or lose data", async () => {
  const { kv, data, writes } = storage()
  const history = createSessionHistory(kv)
  await history.save("ses_a", record([entry("old", { output: "original" })]))
  const before = JSON.stringify(data.get(sessionHistoryKey("ses_a")))
  const count = writes.length
  const failing = createHistory(kv, {
    put: async () => { throw new Error("Disk full") },
    read: async (hash) => texts.get(hash)!,
  })
  await assert.rejects(failing.save("ses_a", record([entry("new")])), /Disk full/)
  assert.equal(JSON.stringify(data.get(sessionHistoryKey("ses_a"))), before)
  assert.equal(writes.length, count)
  assert.deepEqual((await history.load("ses_a")).entries.map((item) => item.id), ["old"])
})

test("hosts without atomic updates cannot silently fall back to unsafe writes", async () => {
  const { kv, writes } = storage()
  delete kv.update
  const history = createSessionHistory(kv)
  await assert.rejects(history.save("ses_a", record([entry("a")])), /Atomic/)
  assert.equal(writes.length, 0)
})
