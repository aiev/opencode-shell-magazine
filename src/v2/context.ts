/**
 * V2 (opencode2) TUI plugin API — 最小本地类型。
 * 运行时由宿主提供，此处仅用于本地类型检查；
 * 结构对应 @opencode/plugin 2.0.15 的 tui/context + @opencode/client 的形状。
 */

export interface App {
  readonly version: string
  readonly channel: string
}

export interface Theme {
  readonly hue: {
    readonly interactive: { readonly 300: string }
    readonly accent: { readonly 500: string }
  }
  readonly text: {
    readonly default: string
    readonly subdued: string
    readonly feedback: {
      readonly success: { readonly default: string }
      readonly error: { readonly default: string }
      readonly warning: { readonly default: string }
    }
  }
}

export interface LocationRef {
  readonly directory?: string
}

/** 宿主 shell 注册表条目（GET /api/shell）。 */
export interface ShellInfo {
  readonly id: string
  readonly status: "running" | "exited" | "timeout" | "killed"
  readonly command: string
  readonly cwd: string
  readonly shell: string
  readonly file: string
  readonly pid?: number
  readonly exit?: number
  readonly metadata: Record<string, any>
  readonly time: { readonly started: number; readonly completed?: number }
}

export interface ShellOutput {
  readonly output: string
  readonly cursor: number
  readonly size: number
  readonly truncated: boolean
}

/** 会话消息（assistant/user/shell 等；shell 消息带 shellID/command/status/exit/output）。 */
export interface MessageInfo {
  readonly id: string
  readonly type: string
  readonly content?: unknown[]
  readonly time?: { readonly created?: number; readonly completed?: number }
  readonly shellID?: string
  readonly command?: string
  readonly status?: string
  readonly exit?: number
  readonly output?: ShellOutput
  readonly [key: string]: any
}

export interface Data {
  readonly session: {
    readonly message: {
      list(sessionID: string): MessageInfo[]
    }
  }
  readonly shell: {
    list(location?: LocationRef): ShellInfo[]
    get(id: string): ShellInfo | undefined
    sync(location?: LocationRef): Promise<void>
    invalidate(location?: LocationRef): void
  }
  readonly location: {
    default(): LocationRef
  }
  readonly on: (type: string, handler: (event: unknown) => void) => () => void
}

export interface Storage {
  store<Value extends object>(
    key: string,
    options: { readonly initial: Value },
  ): readonly [Value, (mutation: (draft: Value) => void) => Promise<void>]
}

export type SlotClaim = {
  readonly render: (input: Record<string, any>) => unknown
} & (
  | { readonly append: string; readonly prepend?: never; readonly before?: never; readonly after?: never; readonly replace?: never }
  | { readonly prepend: string; readonly append?: never; readonly before?: never; readonly after?: never; readonly replace?: never }
  | { readonly before: string; readonly append?: never; readonly prepend?: never; readonly after?: never; readonly replace?: never }
  | { readonly after: string; readonly append?: never; readonly prepend?: never; readonly before?: never; readonly replace?: never }
  | { readonly replace: string; readonly append?: never; readonly prepend?: never; readonly before?: never; readonly after?: never }
)

export interface KeymapCommand {
  readonly id?: string
  readonly title?: string
  readonly description?: string
  readonly group?: string
  readonly palette?: true
  readonly slash?: { readonly name: string; readonly aliases?: string[]; readonly arguments?: true }
  readonly run: (input?: string) => void | false | Promise<void>
}

export type AttentionWhen = "always" | "focused" | "blurred"
export type AttentionSoundName = "default" | "question" | "permission" | "error" | "done" | "subagent_done"

export interface AttentionNotifyOptions {
  readonly title?: string
  readonly message: string
  readonly notification?: boolean | { readonly when?: AttentionWhen }
  readonly sound?: boolean | { readonly name?: AttentionSoundName; readonly volume?: number; readonly when?: AttentionWhen }
}

/** 最小 client 面：shell 终止与输出读取走官方生成 client。 */
export interface ClientLike {
  readonly shell: {
    remove(input: { id: string; location?: LocationRef }): Promise<void>
    output(input: { id: string; location?: LocationRef; cursor?: number; limit?: number }): Promise<ShellOutput>
  }
}

export interface Context {
  readonly app: App
  readonly options: Record<string, any>
  readonly location?: LocationRef
  readonly renderer: { readonly terminalWidth: number }
  readonly theme: Theme
  readonly data: Data
  readonly client: ClientLike
  readonly storage: Storage
  readonly attention: {
    notify(options: AttentionNotifyOptions): Promise<unknown>
  }
  readonly ui: {
    slot(claim: SlotClaim): () => void
    readonly toast: {
      show(options: { readonly message: string; readonly title?: string; readonly variant?: string; readonly duration?: number }): void
    }
    readonly dialog: {
      confirm(options: {
        readonly title: string
        readonly message: string
        readonly label?: { readonly confirm?: string; readonly cancel?: string }
      }): Promise<boolean | undefined>
      select<Value>(options: {
        readonly title: string
        readonly placeholder?: string
        readonly options: readonly {
          readonly title: string
          readonly value: Value
          readonly description?: string
          readonly category?: string
          readonly disabled?: boolean
        }[]
        readonly current?: Value
      }): Promise<Value | undefined>
    }
  }
  readonly keymap: {
    layer(input: () => {
      readonly mode?: string
      readonly priority?: number
      readonly commands?: readonly KeymapCommand[]
    }): void
  }
}

export type PluginModule = {
  readonly id: string
  readonly setup: (context: Context) => void | (() => void | Promise<void>) | Promise<void | (() => void | Promise<void>)>
}
