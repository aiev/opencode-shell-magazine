import assert from "node:assert/strict"
import test from "node:test"
import { entryKey, findShellEntryKey, mergeShellEntries, mergeShellEntry } from "../src/panel/entry-map"
import { entryFromShellInfo, entryFromShellMessage, entryFromToolPart } from "../src/panel/shell-data"

test("mergeShellEntry: terminal state wins over a later running event", () => {
  const done = entryFromShellInfo({
    id: "sh_1", status: "exited", command: "x", exit: 0, metadata: {}, time: { started: 1, completed: 2 },
  })
  const running = entryFromShellInfo({
    id: "sh_1", status: "running", command: "x", metadata: {}, time: { started: 1 },
  })
  const merged = mergeShellEntry(done, running)
  assert.equal(merged.status, "exited")
  assert.equal(merged.exit, 0)
  assert.equal(merged.endedAt, 2)
})

test("mergeShellEntry: field union keeps source, file and pid", () => {
  const prev = entryFromShellMessage({
    id: "m", type: "shell", shellID: "sh_2", command: "git status", status: "running",
  })!
  const next = entryFromShellInfo({
    id: "sh_2", status: "running", command: "git status", file: "/tmp/o.out", pid: 7, metadata: {}, time: { started: 5 },
  })
  const merged = mergeShellEntry(prev, next)
  assert.equal(merged.source, "user")
  assert.equal(merged.file, "/tmp/o.out")
  assert.equal(merged.pid, 7)
})

test("findShellEntryKey matches tool history entries by shellID", () => {
  const hist = entryFromToolPart({
    type: "tool",
    id: "call_1",
    name: "shell",
    time: { created: 10 },
    state: { status: "completed", input: { command: "sleep 9" }, metadata: { status: "running", shellID: "sh_5" } },
  })!
  const map = new Map([[entryKey(hist), hist]])
  const key = findShellEntryKey(
    map,
    entryFromShellInfo({ id: "sh_5", status: "running", command: "sleep 9", metadata: {}, time: { started: 10 } }),
  )
  assert.equal(key, "sh_5")
})

test("mergeShellEntries dedupes by shell and keeps transitions", () => {
  const a = entryFromShellInfo({ id: "sh_a", status: "running", command: "a", metadata: {}, time: { started: 1 } })
  const b = entryFromShellInfo({ id: "sh_b", status: "running", command: "b", metadata: {}, time: { started: 2 } })
  const bDone = entryFromShellInfo({
    id: "sh_b", status: "exited", command: "b", exit: 0, metadata: {}, time: { started: 2, completed: 9 },
  })
  const merged = mergeShellEntries([a, b], [bDone])
  assert.equal(merged.length, 2)
  const mb = merged.find((e) => e.id === "sh_b")!
  assert.equal(mb.status, "exited")
  assert.equal(mb.endedAt, 9)
})
