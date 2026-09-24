import assert from "node:assert/strict"
import test from "node:test"
import {
  durationOf,
  entryFromShellInfo,
  entryFromShellMessage,
  entryFromToolPart,
  normalizeShellStatus,
  scanShellEntries,
  tailLines,
} from "../src/panel/shell-data"

test("entryFromShellInfo maps registry fields", () => {
  const e = entryFromShellInfo({
    id: "sh_1",
    status: "running",
    command: "pnpm test",
    cwd: "/tmp",
    shell: "/bin/bash",
    file: "/tmp/x.out",
    pid: 42,
    metadata: { sessionID: "ses_1" },
    time: { started: 1000 },
  })
  assert.equal(e.id, "sh_1")
  assert.equal(e.status, "running")
  assert.equal(e.startedAt, 1000)
  assert.equal(e.pid, 42)
  assert.equal(e.endedAt, undefined)
})

test("entryFromToolPart: foreground completed carries exit, time and output", () => {
  const e = entryFromToolPart({
    type: "tool",
    id: "call_1",
    name: "shell",
    time: { created: 100, ran: 110, completed: 200 },
    state: {
      status: "completed",
      input: { command: "ls", timeout: 5000, workdir: "/w" },
      metadata: { exit: 0, truncated: false },
      content: [{ type: "text", text: "a\nb" }],
    },
  })
  assert.ok(e)
  assert.equal(e!.status, "exited")
  assert.equal(e!.exit, 0)
  assert.equal(e!.endedAt, 200)
  assert.equal(e!.output, "a\nb")
  assert.equal(e!.cwd, "/w")
  assert.equal(e!.timeout, 5000)
})

test("entryFromToolPart: backgrounded command stays running (part time is not the end)", () => {
  const e = entryFromToolPart({
    type: "tool",
    id: "call_2",
    name: "shell",
    time: { created: 100, completed: 120 },
    state: {
      status: "completed",
      input: { command: "sleep 100" },
      metadata: { status: "running", shellID: "sh_2" },
    },
  })
  assert.ok(e)
  assert.equal(e!.status, "running")
  assert.equal(e!.shellID, "sh_2")
  assert.equal(e!.endedAt, undefined)
})

test("entryFromShellMessage maps user shells", () => {
  const e = entryFromShellMessage({
    id: "msg_1",
    type: "shell",
    shellID: "sh_3",
    command: "git status",
    status: "exited",
    exit: 0,
    time: { created: 1, completed: 2 },
    output: { output: "ok", cursor: 2, size: 2, truncated: false },
  })
  assert.ok(e)
  assert.equal(e!.source, "user")
  assert.equal(e!.status, "exited")
  assert.equal(e!.output, "ok")
  assert.equal(e!.endedAt, 2)
})

test("scanShellEntries collects tool parts and shell messages only", () => {
  const entries = scanShellEntries([
    {
      id: "m1",
      type: "assistant",
      content: [
        { type: "text", text: "hi" },
        { type: "tool", id: "call_1", name: "shell", state: { status: "completed", input: { command: "ls" }, metadata: { exit: 0 } } },
        { type: "tool", id: "call_2", name: "read", state: { input: { filePath: "/x" } } },
      ],
    },
    { id: "m2", type: "shell", shellID: "sh_9", command: "pwd", status: "running" },
    { id: "m3", type: "user", content: [{ type: "text", text: "hey" }] },
  ])
  assert.equal(entries.length, 2)
  assert.equal(entries[0].id, "tool:call_1")
  assert.equal(entries[1].source, "user")
})

test("normalizeShellStatus / tailLines / durationOf", () => {
  assert.equal(normalizeShellStatus("killed"), "killed")
  assert.equal(normalizeShellStatus("completed"), "exited")
  assert.equal(normalizeShellStatus("weird"), "running")
  assert.equal(tailLines("a\nb\nc", 2), "b\nc")
  assert.equal(tailLines("a\nb", 5), "a\nb")
  const e = entryFromShellInfo({
    id: "sh_1",
    status: "exited",
    command: "x",
    metadata: {},
    time: { started: 1000, completed: 3000 },
  })
  assert.equal(durationOf(e, 9999), 2000)
})
