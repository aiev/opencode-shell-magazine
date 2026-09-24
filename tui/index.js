// tui/index.js — V2 (opencode2) entry point: the host reads the { id, setup } protocol;
// the implementation lives in dist/tui.js (esbuild output).
import mod from "./../dist/tui.js"

export default {
  id: "opencode-shell-magazine",
  setup: mod.setup,
}
