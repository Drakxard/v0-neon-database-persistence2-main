import assert from "node:assert/strict"
import test from "node:test"
import { synchronizeSynthesisFolder } from "../lib/client/synthesis-sync.ts"
import { createEmptySynthesisWorkspace } from "../lib/synthesis-workspace.ts"
import { folderFixture } from "./helpers/synthesis-folder-fixture.mts"

const context = { subjectId: "db", weekNumber: 23 }
const notes = (text: string) => ({ ...createEmptySynthesisWorkspace(), document: { type: "doc", content: [
  { type: "heading", attrs: { level: 1, synthesisId: "db" }, content: [{ type: "text", text }] },
] } })

function remoteFixture() {
  const state = { workspace: null as ReturnType<typeof notes> | null, etag: null as string | null, writes: 0, reads: 0, offline: false, beforePut: null as (() => Promise<void>) | null }
  const fetcher = (async (_url: unknown, init?: RequestInit) => {
    if (state.offline) throw new Error("offline")
    if (init?.method !== "PUT") {
      state.reads++
      return Response.json({ workspace: state.workspace, etag: state.etag })
    }
    const body = JSON.parse(String(init.body))
    await state.beforePut?.(); state.beforePut = null
    state.workspace = body.workspace; state.etag = String(++state.writes)
    return Response.json({ workspace: state.workspace, etag: state.etag })
  }) as typeof fetch
  return { state, fetcher }
}

test("offline folder saves survive browser data removal and publish on retry", async () => {
  const { store, reopen } = folderFixture()
  const { state, fetcher } = remoteFixture()
  const original = notes("DB: dependencias funcionales")
  await store.save(context, original)
  state.offline = true
  await assert.rejects(synchronizeSynthesisFolder(context, store, fetcher, async () => null), /offline/)
  assert.deepEqual((await reopen().read(context))?.workspace, original)
  state.offline = false
  await synchronizeSynthesisFolder(context, reopen(), fetcher, async () => null)
  assert.deepEqual(state.workspace, original)
  assert.equal(state.writes, 1)
})

test("publication never downloads R2 into the local folder", async () => {
  const { store, reopen } = folderFixture()
  const { state, fetcher } = remoteFixture()
  const local = notes("DB: fuente local")
  await store.save(context, local)
  state.workspace = notes("DB: copia remota vieja"); state.etag = "old"
  await synchronizeSynthesisFolder(context, store, fetcher, async () => null)
  assert.deepEqual((await reopen().read(context))?.workspace, local)
  assert.deepEqual(state.workspace, local)
  assert.equal(state.reads, 0)
})

test("stale R2 content cannot block the authoritative local publication", async () => {
  const { store } = folderFixture()
  const { state, fetcher } = remoteFixture()
  const local = notes("DB: cambios locales")
  await store.save(context, local)
  state.workspace = notes("DB: cambios remotos"); state.etag = "newer"
  await synchronizeSynthesisFolder(context, store, fetcher, async () => null)
  assert.deepEqual((await store.read(context))?.workspace, local)
  assert.deepEqual(state.workspace, local)
  assert.equal(state.reads, 0)
})

test("edits saved during an upload are sent in the next pass", async () => {
  const { store } = folderFixture()
  const { state, fetcher } = remoteFixture()
  await store.save(context, notes("primero"))
  const latest = notes("DB: editado durante la subida")
  state.beforePut = () => store.save(context, latest)
  await synchronizeSynthesisFolder(context, store, fetcher, async () => null)
  assert.deepEqual(state.workspace, latest)
  assert.deepEqual((await store.read(context))?.workspace, latest)
  assert.equal(state.writes, 2)
})
