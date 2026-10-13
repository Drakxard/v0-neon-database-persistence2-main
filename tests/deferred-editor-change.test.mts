import assert from "node:assert/strict"
import test from "node:test"
import { createDeferredEditorChange } from "../lib/client/deferred-editor-change.ts"
import { createAsyncLocalAutosave } from "../lib/client/async-local-autosave.ts"

test("typing serializes once after a pause, with a bounded wait during continuous input", t => {
  t.mock.timers.enable({ apis: ["setTimeout"] })
  let text = "", reads = 0, pending = 0
  const output: string[] = []
  const changes = createDeferredEditorChange(() => { reads++; return text }, value => output.push(value), () => { pending++ })
  for (let i = 0; i < 10; i++) { text += "a"; changes.markDirty(); t.mock.timers.tick(100) }
  assert.equal(reads, 0)
  assert.equal(pending, 1)
  t.mock.timers.tick(350)
  assert.deepEqual(output, [text])
  for (let i = 0; i < 16; i++) { text += "b"; changes.markDirty(); t.mock.timers.tick(100) }
  assert.equal(reads, 2)
  assert.equal(changes.pending, true)
  changes.flush()
  assert.equal(output.at(-1), text)
  assert.equal(reads, 3)
})

test("save and exit flush the latest editor document, including edits during an in-flight write", async () => {
  let text = "first", snapshot = "", finish!: () => void
  const writes: string[] = []
  const changes = createDeferredEditorChange(() => text, value => { snapshot = value }, () => save.markDirty())
  const save = createAsyncLocalAutosave(async () => {
    writes.push(snapshot)
    if (writes.length === 1) await new Promise<void>(resolve => { finish = resolve })
  }, () => {}, changes.flush)
  changes.markDirty()
  const saving = save.flush()
  text = "latest"; changes.markDirty()
  finish()
  assert.equal(await saving, true)
  assert.deepEqual(writes, ["first", "latest"])
  assert.equal(save.dirty, false)
  assert.equal(changes.pending, false)
})
