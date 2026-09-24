// tui/index.js——V2（opencode2）入口：宿主读取 { id, setup } 协议，
// 实现在 dist/tui.js（esbuild 产物）。
import mod from "./../dist/tui.js"

export default {
  id: "opencode-shell-magazine",
  setup: mod.setup,
}
