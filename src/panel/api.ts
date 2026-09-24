import type { KVApi } from "../core/kv"

/** Panel-facing shell data contract; the V2 adapter implements it so the
 *  component never touches host APIs directly. */
export interface ShellPanelApi {
  kv: KVApi
  shell: {
    /** 当前 location 的 shell 注册表快照（包含前台/后台运行中的命令）。 */
    list(): ShellInfoLike[]
    /** 从服务器刷新注册表缓存；返回是否成功（失败时不做“已结束”推断）。 */
    sync(): Promise<boolean>
    onStarted(cb: (e: { sessionID: string; shell: ShellInfoLike }) => void): () => void
    onEnded(cb: (e: { sessionID: string; shell: ShellInfoLike; output?: ShellOutputLike }) => void): () => void
    /** 终止运行中的 shell（DELETE /api/shell/{id}）。 */
    kill(id: string): Promise<void>
    /** 读取 shell 输出（后台 .out 的游标分页读取）。 */
    readOutput(id: string, cursor?: number): Promise<ShellOutputLike | undefined>
  }
  session: {
    /** 原始消息列表（历史扫描：工具 part 与 shell 消息）。 */
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
