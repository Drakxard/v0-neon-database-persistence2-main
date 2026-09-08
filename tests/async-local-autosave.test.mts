import assert from "node:assert/strict"
import test from "node:test"
import { createAsyncLocalAutosave } from "../lib/client/async-local-autosave.ts"

test("saving remains dirty until the folder finishes and includes edits made in flight", async () => {
  let finish!: () => void
  let text = "primero"
  const writes: string[] = []
  const statuses: string[] = []
  const save = createAsyncLocalAutosave(async () => {
    writes.push(text)
    if (writes.length === 1) await new Promise<void>((resolve) => { finish = resolve })
  }, (status) => statuses.push(status))
  save.markDirty()
  const pending = save.flush()
  assert.equal(save.dirty, true)
  assert.equal(statuses.includes("saved"), false)
  text = "segundo"; save.markDirty()
  finish()
  assert.equal(await pending, true)
  assert.deepEqual(writes, ["primero", "segundo"])
  assert.equal(save.dirty, false)
  assert.equal(await save.flush(), true)
  assert.equal(writes.length, 2)
})

test("permission failures retain dirty state and a manual retry waits for a verified save", async () => {
  let fail = true
  const statuses: string[] = []
  const save = createAsyncLocalAutosave(async () => { if (fail) throw new Error("permission") }, (status) => statuses.push(status))
  save.markDirty()
  assert.equal(await save.flush(), false)
  assert.equal(save.dirty, true)
  assert.equal(statuses.at(-1), "error")
  fail = false
  assert.equal(await save.flush(), true)
  assert.equal(save.dirty, false)
  assert.equal(statuses.at(-1), "saved")
})
