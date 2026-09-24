import type { Context, LocationRef, ShellInfo } from "./context"
import type { ShellInfoLike, ShellPanelApi, ShellOutputLike } from "../panel/api"

const asRecord = (v: unknown): Record<string, any> =>
  v && typeof v === "object" ? (v as Record<string, any>) : {}

/**
 * V2 适配器：把宿主 API 收敛成面板契约。
 *
 * - kv：宿主持久化存储（`shell_magazine.<key>`），并发 TUI 用原子 update 合并；
 * - shell：注册表快照 + `session.shell.*` 事件 + 官方 client（kill / 读输出）；
 * - session.messages：历史扫描（工具 part 与 shell 消息）。
 */
export function createShellApi(context: Context): ShellPanelApi {
  const kvStore = new Map<string, [Record<string, any>, (fn: (d: Record<string, any>) => void) => Promise<void>]>()

  const kvGet = <T>(key: string, fallback?: T): T | undefined => {
    let entry = kvStore.get(key)
    if (!entry) {
      const created = context.storage.store<Record<string, any>>(`shell_magazine.${key}`, {
        initial: { value: fallback },
      })
      entry = created as [Record<string, any>, (fn: (d: Record<string, any>) => void) => Promise<void>]
      kvStore.set(key, entry)
    }
    const v = entry[0].value
    return v === undefined ? fallback : (v as T)
  }
  const kvSet = (key: string, value: unknown): Promise<void> => {
    let entry = kvStore.get(key)
    if (!entry) {
      const created = context.storage.store<Record<string, any>>(`shell_magazine.${key}`, {
        initial: { value },
      })
      entry = created as [Record<string, any>, (fn: (d: Record<string, any>) => void) => Promise<void>]
      kvStore.set(key, entry)
    }
    const [, mutate] = entry
    return mutate((d) => { d.value = value })
  }
  // 原子 read-modify-write：宿主在存储锁内基于最新磁盘值应用 updater，
  // 并发 TUI 实例会 merge，而不是用过期快照互相覆盖。
  const kvUpdate = (key: string, updater: (current: unknown) => unknown): Promise<void> => {
    let entry = kvStore.get(key)
    if (!entry) {
      const created = context.storage.store<Record<string, any>>(`shell_magazine.${key}`, {
        initial: { value: undefined },
      })
      entry = created as [Record<string, any>, (fn: (d: Record<string, any>) => void) => Promise<void>]
      kvStore.set(key, entry)
    }
    const [, mutate] = entry
    return mutate((d) => { d.value = updater(d.value) })
  }

  const location = (): LocationRef | undefined => context.location

  const toLike = (s: ShellInfo): ShellInfoLike => ({
    id: s.id,
    status: s.status,
    command: s.command,
    cwd: s.cwd,
    shell: s.shell,
    file: s.file,
    pid: s.pid,
    exit: typeof s.exit === "number" ? s.exit : undefined,
    metadata: s.metadata,
    time: s.time,
  })

  return {
    kv: { get: kvGet, set: kvSet, update: kvUpdate },
    shell: {
      list: () => {
        try { return (context.data.shell.list(location()) ?? []).map(toLike) } catch { return [] }
      },
      sync: async () => {
        try {
          await context.data.shell.sync(location())
          return true
        } catch { return false }
      },
      onStarted: (cb) => context.data.on("session.shell.started", (e) => {
        const d = asRecord(asRecord(e).data)
        const shell = d.shell as ShellInfo | undefined
        if (!shell?.id) return
        cb({ sessionID: String(d.sessionID ?? ""), shell: toLike(shell) })
      }),
      onEnded: (cb) => context.data.on("session.shell.ended", (e) => {
        const d = asRecord(asRecord(e).data)
        const shell = d.shell as ShellInfo | undefined
        if (!shell?.id) return
        const out = asRecord(d.output)
        const output = typeof out.output === "string"
          ? { output: out.output, cursor: Number(out.cursor) || 0, size: Number(out.size) || 0, truncated: out.truncated === true }
          : undefined
        cb({ sessionID: String(d.sessionID ?? ""), shell: toLike(shell), output })
      }),
      kill: async (id) => {
        await context.client.shell.remove({ id, location: location() })
      },
      readOutput: async (id, cursor) => {
        try {
          const res = await context.client.shell.output({
            id, location: location(), cursor,
          })
          const out = (res as unknown as ShellOutputLike) ?? undefined
          if (out && typeof out.output === "string") return out
          return undefined
        } catch { return undefined }
      },
    },
    session: {
      messages: (sid) => {
        try { return context.data.session.message.list(sid) } catch { return undefined }
      },
    },
    attention: {
      notify: async (options) => {
        try {
          await context.attention.notify({
            title: options.title,
            message: options.message,
            notification: { when: "blurred" },
            sound: { name: "done", when: "blurred" },
          })
        } catch {}
      },
    },
    ui: {
      toast: (message, opts) => context.ui.toast.show({ message, title: opts?.title, variant: opts?.variant, duration: opts?.duration }),
      confirm: async (title, message) => {
        try { return await context.ui.dialog.confirm({ title, message }) } catch { return undefined }
      },
    },
  }
}
