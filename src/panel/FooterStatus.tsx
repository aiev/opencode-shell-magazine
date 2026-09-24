/** @jsxImportSource @opentui/solid */

import type { JSX } from "@opentui/solid"
import { createSignal, onCleanup, onMount, Show } from "solid-js"
import type { ShellPanelApi } from "./api"
import { collectSubSessions, countRunningShells } from "./shell-data"
import { desaturateTo, FALLBACK, MAX_SAT } from "../core/color"

/**
 * Prompt-footer indicator: how many shell commands from this session (and, when enabled, its
 * subagent sessions) are running. Registry-driven and independent from the sidebar panel, so it
 * stays accurate even while the panel is hidden.
 */
export function FooterStatus(props: {
  api: ShellPanelApi
  theme: Record<string, unknown>
  sessionID: string
  enabled: () => boolean
  showSubagents: () => boolean
  label: () => string
}): JSX.Element {
  const [count, setCount] = createSignal(0)

  const update = () => {
    if (!props.enabled()) {
      setCount(0)
      return
    }
    try {
      const sub = new Set<string>()
      if (props.showSubagents()) {
        for (const ref of collectSubSessions(props.api.session.messages(props.sessionID) ?? [])) sub.add(ref.id)
      }
      setCount(countRunningShells(props.api.shell.list(), props.sessionID, sub))
    } catch {
      setCount(0)
    }
  }

  onMount(() => {
    void props.api.shell.sync().then(update).catch(() => {})
    const offStarted = props.api.shell.onStarted(() => update())
    const offEnded = props.api.shell.onEnded(() => update())
    const timer = setInterval(() => void props.api.shell.sync().then(update).catch(() => {}), 3000)
    onCleanup(() => {
      offStarted()
      offEnded()
      clearInterval(timer)
    })
  })

  const color = () => desaturateTo(props.theme.warning, MAX_SAT, FALLBACK.warning)

  return (
    <Show when={props.enabled() && count() > 0}>
      <text>
        <span style={{ fg: color() }}>{`\u25cf ${count()} ${props.label()}`}</span>
      </text>
    </Show>
  )
}
