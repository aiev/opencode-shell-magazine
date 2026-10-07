import { createHash, randomUUID } from "node:crypto"
import { access, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import { join } from "node:path"
import { promisify } from "node:util"
import { gzip, gunzip } from "node:zlib"

const compress = promisify(gzip)
const decompress = promisify(gunzip)

export interface TextBlobs {
  put(text: string): Promise<string>
  read(hash: string): Promise<string>
}

export function historyBlobsDirectory(channel: string): string {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(channel) || channel === "." || channel === "..") {
    throw new Error("Invalid OpenCode channel")
  }
  // A sibling of `tui`, NOT a child: host storage must never watch these payloads.
  return join(process.env.XDG_STATE_HOME || join(homedir(), ".local", "state"),
    "opencode", channel, "shell-magazine", "text")
}

/** Immutable content-addressed payloads need no cross-process write lock. Write
 * the complete gzip to a private temporary file, then publish it atomically.
 * Concurrent writers of the same hash publish the exact same original text. */
export function createFileTextBlobs(directory: string): TextBlobs {
  const pending = new Map<string, Promise<string>>()
  const known = new Set<string>()
  const filename = (hash: string) => {
    if (!/^[a-f0-9]{64}$/.test(hash)) throw new Error("Invalid shell text hash")
    return join(directory, hash.slice(0, 2), `${hash}.gz`)
  }
  return {
    put: (text) => {
      // JSON framing preserves lone UTF-16 surrogates too; UTF-8 encoding raw JS
      // strings would replace them, silently changing a copied command.
      const json = JSON.stringify(text)
      const hash = createHash("sha256").update(json).digest("hex")
      if (known.has(hash)) return Promise.resolve(hash)
      const existing = pending.get(hash)
      if (existing) return existing
      const operation = (async () => {
        const file = filename(hash)
        try { await access(file); return hash } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
        }
        await mkdir(join(directory, hash.slice(0, 2)), { recursive: true, mode: 0o700 })
        const temp = `${file}.${process.pid}.${randomUUID()}.tmp`
        try {
          await writeFile(temp, await compress(json, { level: 3 }), { mode: 0o600, flag: "wx" })
          await rename(temp, file)
        } finally {
          await unlink(temp).catch(() => {})
        }
        return hash
      })()
      pending.set(hash, operation)
      operation.then(() => {
        pending.delete(hash)
        known.add(hash)
        if (known.size > 2048) known.delete(known.values().next().value!)
      }, () => pending.delete(hash))
      return operation
    },
    read: async (hash) => {
      const json = (await decompress(await readFile(filename(hash)))).toString("utf8")
      const text = JSON.parse(json)
      if (typeof text !== "string" || createHash("sha256").update(json).digest("hex") !== hash) {
        throw new Error("Shell text checksum mismatch")
      }
      return text
    },
  }
}
