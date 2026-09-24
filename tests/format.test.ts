import assert from "node:assert/strict"
import test from "node:test"
import { fmtDuration, truncate, visualWidth } from "../src/core/format"

test("fmtDuration honours every display mode", () => {
  assert.equal(fmtDuration(45_320, false, "short"), "45.32s")
  assert.equal(fmtDuration(112 * 60_000 + 35_000, false, "short"), "112m35s")
  assert.equal(fmtDuration(45_300, false, "decimal"), "45.3s")
  assert.equal(fmtDuration(45_000, false, "clock"), "0:45")
  assert.equal(fmtDuration(6_755_000, false, "clock"), "1:52:35")
  assert.equal(fmtDuration(45_000, false, "compact"), "45s")
  assert.equal(fmtDuration(6_755_000, false, "compact"), "1h52m")
  assert.equal(fmtDuration(45_320, false, "seconds"), "45s")
})

test("fmtDuration hides noisy sub-2s values while running", () => {
  assert.equal(fmtDuration(1000, true), "")
  assert.equal(fmtDuration(2500, true, "short"), "2.50s")
})

test("truncate/visualWidth respect wide characters", () => {
  assert.equal(visualWidth("中文"), 4)
  assert.equal(truncate("hello world", 8), "hello w\u2026")
  assert.equal(truncate("中文中文", 5), "中文\u2026")
})
