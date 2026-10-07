import assert from "node:assert/strict"
import test from "node:test"
import { mkdtemp, readdir, readFile, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createFileTextBlobs, historyBlobsDirectory } from "../src/core/text-blobs"

test("concurrent writers publish one complete, private payload readable after restart", async () => {
  const directory = await mkdtemp(join(tmpdir(), "shell-blobs-"))
  const one = createFileTextBlobs(directory)
  const two = createFileTextBlobs(directory)
  const text = "你好 🚀 ação\n".repeat(10000) + "\ud800"
  const [first, second] = await Promise.all([one.put(text), two.put(text)])
  assert.equal(first, second)
  assert.equal(await createFileTextBlobs(directory).read(first), text)
  const folder = join(directory, first.slice(0, 2))
  assert.deepEqual(await readdir(folder), [`${first}.gz`])
  if (process.platform !== "win32") assert.equal((await stat(join(folder, `${first}.gz`))).mode & 0o777, 0o600)
})

test("identical text is deduplicated and never rewritten", async () => {
  const directory = await mkdtemp(join(tmpdir(), "shell-blobs-"))
  const blobs = createFileTextBlobs(directory)
  const hash = await blobs.put("original")
  const file = join(directory, hash.slice(0, 2), `${hash}.gz`)
  const before = await stat(file)
  const bytes = await readFile(file)
  assert.equal(await blobs.put("original"), hash)
  assert.equal((await stat(file)).mtimeMs, before.mtimeMs)
  assert.deepEqual(await readFile(file), bytes)
})

test("corruption and unsafe hashes are rejected rather than shown as output", async () => {
  const directory = await mkdtemp(join(tmpdir(), "shell-blobs-"))
  const blobs = createFileTextBlobs(directory)
  const one = await blobs.put("first")
  const two = await blobs.put("second")
  await writeFile(join(directory, one.slice(0, 2), `${one}.gz`), await readFile(join(directory, two.slice(0, 2), `${two}.gz`)))
  await assert.rejects(blobs.read(one), /checksum/)
  await assert.rejects(blobs.read("../other"), /Invalid/)
  assert.throws(() => historyBlobsDirectory(".."), /Invalid/)
})
