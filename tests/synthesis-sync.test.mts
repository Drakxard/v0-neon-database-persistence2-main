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
  const state = { workspace: null as ReturnType<typeof notes> | null, etag: null as string | null, writes: 0, offline: false, beforePut: null as (() => Promise<void>) | null }
  const fetcher = (async (_url: unknown, init?: RequestInit) => {
    if (state.offline) throw new Error("offline")
    if (init?.method === "PUT") {
      const body = JSON.parse(String(init.body))
      if (body.etag !== state.etag) return Response.json({ error: "conflict" }, { status: 409 })
      await state.beforePut?.(); state.beforePut = null
      state.workspace = body.workspace; state.etag = String(++state.writes)
    }
    return Response.json({ workspace: state.workspace, etag: state.etag })
  }) as typeof fetch
  return { state, fetcher }
}

test("offline folder saves survive browser data removal and synchronize on retry", async () => {
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

test("downloads are persisted in the directory and keep the prior text recoverable", async () => {
  const { store, reopen } = folderFixture()
  const { state, fetcher } = remoteFixture()
  const old = notes("DB: texto anterior")
  await store.save(context, old)
  await synchronizeSynthesisFolder(context, store, fetcher, async () => null)
  state.workspace = notes("DB: texto remoto"); state.etag = "another-device"
  await synchronizeSynthesisFolder(context, store, fetcher, async () => null)
  assert.deepEqual((await reopen().read(context))?.workspace, state.workspace)
  assert.ok((await store.listCopies()).some((copy) => copy.preview.includes("anterior")))
})

test("conflicting folder and R2 edits preserve both documents", async () => {
  const { store } = folderFixture()
  const { state, fetcher } = remoteFixture()
  await store.save(context, notes("base"))
  await synchronizeSynthesisFolder(context, store, fetcher, async () => null)
  const local = notes("DB: cambios locales")
  await store.save(context, local)
  const remote = notes("DB: cambios remotos")
  state.workspace = remote; state.etag = "newer"
  await assert.rejects(synchronizeSynthesisFolder(context, store, fetcher, async () => null), /otra versión/)
  assert.deepEqual((await store.read(context))?.workspace, local)
  assert.deepEqual(state.workspace, remote)
  assert.equal(state.writes, 1)
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

test("invalid remote data cannot replace an existing folder document", async () => {
  const { store } = folderFixture()
  const original = notes("DB: original")
  await store.save(context, original)
  const fetcher = (async () => Response.json({ workspace: { version: 2 }, etag: "invalid" })) as typeof fetch
  await assert.rejects(synchronizeSynthesisFolder(context, store, fetcher, async () => null), /formato inválido/)
  assert.deepEqual((await store.read(context))?.workspace, original)
})
