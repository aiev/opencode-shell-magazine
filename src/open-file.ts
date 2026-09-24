import { spawn } from "node:child_process"
import { platform } from "node:os"

/** Open a file with the system default program (linux: xdg-open; macOS: open; Windows: start). */
export function openFilePath(path: string): boolean {
  if (!path) return false
  try {
    const os = platform()
    const cmd = os === "darwin" ? "open" : os === "win32" ? "cmd" : "xdg-open"
    const args = os === "win32" ? ["/c", "start", "", path] : [path]
    const child = spawn(cmd, args, { detached: true, stdio: "ignore" })
    child.unref()
    return true
  } catch {
    return false
  }
}
