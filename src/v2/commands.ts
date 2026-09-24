import type { Context, KeymapCommand } from "./context"
import type { ShellPanelApi } from "../panel/api"
import type { SharedSignals } from "../core/types"
import { createT } from "../i18n"
import { PLUGIN_VERSION } from "../_version"
import { clearTick, setClearTick } from "../panel/store"
import { openSettingsMenu } from "./settings-menu"

/** Command layer (registered in the app slot: slash commands stay available when the sidebar is hidden). */
export function makeCommands(context: Context, api: ShellPanelApi, signals: SharedSignals): KeymapCommand[] {
  const t = createT(() => signals.lang())
  return [
    {
      id: "opencode-shell-magazine.shell.settings",
      title: "Shell Magazine: Settings Menu",
      description: "Open the interactive settings menu (Esc to close)",
      slash: { name: "shell-magazine" },
      palette: true,
      run: () => {
        openSettingsMenu(context, api, signals)
      },
    },
    {
      id: "opencode-shell-magazine.shell.clear",
      title: "Shell Magazine: Clear Finished",
      description: "Remove finished shell commands from the panel",
      slash: { name: "shell-magazine-clear" },
      palette: true,
      run: async () => {
        const ok = await context.ui.dialog.confirm({
          title: t("confirm.clear.title"),
          message: t("confirm.clear.message"),
        })
        if (ok) setClearTick(clearTick() + 1)
      },
    },
    {
      id: "opencode-shell-magazine.shell.version",
      title: "Shell Magazine: Version",
      description: "Show plugin version",
      slash: { name: "shell-magazine-version" },
      palette: true,
      run: () => {
        context.ui.toast.show({ message: `opencode-shell-magazine v${PLUGIN_VERSION}` })
      },
    },
  ]
}
