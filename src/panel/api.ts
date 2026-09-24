import type { KVApi } from "../core/kv"

/** Panel-facing shell data contract; the V2 adapter implements it so the
 *  component never touches host APIs directly. */
export interface ShellPanelApi {
  kv: KVApi
  shell: {
    /** Shell registry snapshot for the current location (includes foreground/background running commands). */
    list(): ShellInfoLike[]
    /** Refresh the registry cache from the server; returns whether it succeeded (no "finished" inference on failure). */
    sync(): Promise<boolean>
    onStarted(cb: (e: { sessionID: string; shell: ShellInfoLike }) => void): () => void
    onEnded(cb: (e: { sessionID: string; shell: ShellInfoLike; output?: ShellOutputLike }) => void): () => void
    /** Terminate a running shell (DELETE /api/shell/{id}). */
    kill(id: string): Promise<void>
    /** Read shell output (cursor-paginated read of the background .out file). */
    readOutput(id: string, cursor?: number): Promise<ShellOutputLike | undefined>
  }
  session: {
    /** Raw message list (history scan: tool parts and shell messages). */
    messages(sid: string): unknown[] | undefined
  }
  attention: {
    notify(options: { title?: string; message: string }): Promise<void>
  }
  ui: {
    toast(message: string, opts?: { title?: string; variant?: "success" | "warning" | "error"; duration?: number }): void
    confirm(title: string, message: string): Promise<boolean | undefined>
  }
}

export interface ShellInfoLike {
  id: string
  status: "running" | "exited" | "timeout" | "killed"
  command: string
  cwd?: string
  shell?: string
  file?: string
  pid?: number
  exit?: number
  metadata?: Record<string, any>
  time?: { started?: number; completed?: number }
}

export interface ShellOutputLike {
  output: string
  cursor: number
  size: number
  truncated: boolean
}
