import assert from "node:assert/strict"
import test from "node:test"
import { createLocalAutosave } from "../lib/client/local-autosave.ts"
import { createEmptySynthesisWorkspace, normalizeSynthesisWorkspace } from "../lib/synthesis-workspace.ts"

test("batches typing and restores the complete saved document after reload", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] })
  let writes = 0
  let stored = ""
  const workspace = createEmptySynthesisWorkspace()
  const autosave = createLocalAutosave(() => { writes++; stored = JSON.stringify(workspace) }, () => {})
  for (const text of ["H", "Hola", "Hola mundo"]) {
    workspace.document = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] }
    autosave.markDirty()
    t.mock.timers.tick(200)
  }
  assert.equal(writes, 0)
  assert.equal(autosave.dirty, true)
  t.mock.timers.tick(800)
  assert.equal(writes, 1)
  assert.equal(autosave.dirty, false)
  assert.match(JSON.stringify(normalizeSynthesisWorkspace(JSON.parse(stored)).document), /Hola mundo/)
})

test("continuous edits are saved at least every five seconds", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] })
  let writes = 0
  const autosave = createLocalAutosave(() => { writes++ }, () => {})
  for (let i = 0; i < 10; i++) {
    autosave.markDirty()
    t.mock.timers.tick(500)
  }
  assert.equal(writes, 1)
  assert.equal(autosave.dirty, false)
})

test("failed storage retains unsaved changes until a successful retry", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] })
  let fail = true
  let status = ""
  let text = "Primer borrador"
  let stored = ""
  const autosave = createLocalAutosave(() => {
    if (fail) throw new Error("QuotaExceededError")
    stored = text
  }, (value) => { status = value })
  autosave.markDirty()
  assert.equal(autosave.flush(), false)
  assert.equal(autosave.dirty, true)
  assert.equal(status, "error")
  text = "Borrador actualizado"
  autosave.markDirty()
  fail = false
  assert.equal(autosave.flush(), true)
  assert.equal(stored, text)
  assert.equal(autosave.dirty, false)
  assert.equal(status, "saved")
})

test("leaving or manual saving flushes immediately and cancels duplicate writes", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] })
  let writes = 0
  const autosave = createLocalAutosave(() => { writes++ }, () => {})
  autosave.markDirty()
  assert.equal(autosave.flush(), true)
  t.mock.timers.tick(10000)
  autosave.flush()
  assert.equal(writes, 1)
})
