#!/usr/bin/env node

/**
 * Install script for opencode-shell-magazine.
 *
 * Adds the plugin to the V2 CLI plugin list in
 * `~/.config/opencode/cli.json` (or `$XDG_CONFIG_HOME/opencode/cli.json`).
 *
 * Usage:
 *   node install.mjs
 *   npm explore opencode-shell-magazine -- node install.mjs
 */

import { readFile, writeFile, mkdir, access } from "node:fs/promises"
import { constants } from "node:fs"
import { homedir, platform } from "node:os"
import { join } from "node:path"

const PLUGIN_SPEC = "opencode-shell-magazine"

function configDir() {
  if (platform() === "win32") {
    return join(process.env.APPDATA ?? join(homedir(), "AppData", "Roaming"), "opencode")
  }
  return join(process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"), "opencode")
}

async function exists(p) {
  try { await access(p, constants.F_OK); return true }
  catch { return false }
}

async function readJSONC(p) {
  const raw = await readFile(p, "utf-8")
  const stripped = raw.replace(/^\s*\/\/.*$/gm, "")
  return JSON.parse(stripped)
}

function formatJSONC(obj) {
  return JSON.stringify(obj, null, 2) + "\n"
}

function mergePlugin(existing, spec) {
  const plugins = Array.isArray(existing.plugins) ? existing.plugins : []
  if (plugins.some((p) => (typeof p === "string" ? p : p[0]) === spec)) return false
  existing.plugins = [...plugins, spec]
  return true
}

async function main() {
  const dir = configDir()
  await mkdir(dir, { recursive: true })

  const cliPath = join(dir, "cli.json")
  if (await exists(cliPath)) {
    const cfg = await readJSONC(cliPath)
    if (mergePlugin(cfg, PLUGIN_SPEC)) {
      await writeFile(cliPath, formatJSONC(cfg))
      console.log(`[opencode-shell-magazine] Added to ${cliPath}`)
      console.log("\nDone! Restart OpenCode to load the Shell Magazine sidebar panel.")
    } else {
      console.log(`[opencode-shell-magazine] Already present in ${cliPath}`)
      console.log("\nRestart OpenCode if you haven't yet.")
    }
  } else {
    const cfg = {
      $schema: "https://opencode.ai/v2/cli.json",
      plugins: [PLUGIN_SPEC],
    }
    await writeFile(cliPath, formatJSONC(cfg))
    console.log(`[opencode-shell-magazine] Created ${cliPath}`)
    console.log("\nDone! Restart OpenCode to load the Shell Magazine sidebar panel.")
  }
}

main().catch((err) => {
  console.error("Install failed:", err.message)
  process.exit(1)
})
