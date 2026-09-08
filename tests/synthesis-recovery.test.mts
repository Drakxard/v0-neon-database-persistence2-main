import assert from "node:assert/strict"
import test from "node:test"
import { createEmptySynthesisWorkspace, SYNTHESIS_WORKSPACE_STORAGE_KEY, SYNTHESIS_WORKSPACE_PENDING_KEY } from "../lib/synthesis-workspace.ts"
import { buildSynthesisLocalStorageKey } from "../lib/synthesis-context.ts"
import { synthesisFolderPath, synthesisContent } from "../lib/client/synthesis-folder-store.ts"
import { folderFixture, browserStorage } from "./helpers/synthesis-folder-fixture.mts"
import { migrateSynthesisImagesToFolder } from "../lib/client/synthesis-images.ts"

const context = { subjectId: "db", weekNumber: 23 }
const key = buildSynthesisLocalStorageKey(SYNTHESIS_WORKSPACE_STORAGE_KEY, context)
const pendingKey = buildSynthesisLocalStorageKey(SYNTHESIS_WORKSPACE_PENDING_KEY, context)
const notes = (text: string) => ({ ...createEmptySynthesisWorkspace(), document: { type: "doc", content: [
  { type: "heading", attrs: { level: 1, synthesisId: "db-notes" }, content: [{ type: "text", text }] },
] } })

test("migrates all scoped workspaces and pending envelopes; retains every browser original", async () => {
  const { store, files, reopen } = folderFixture()
  const storage = browserStorage()
  const primary = notes("DB anterior")
  const pending = notes("DB pendiente")
  storage.setItem(key, JSON.stringify(primary))
  storage.setItem(pendingKey, JSON.stringify({ workspace: pending, etag: "legacy" }))
  const other = { subjectId: "db-anterior", weekNumber: 19 }
  storage.setItem(buildSynthesisLocalStorageKey(SYNTHESIS_WORKSPACE_STORAGE_KEY, other), JSON.stringify(notes("Otro ID")))
  storage.setItem("inscreen.sintesis.tree.v1", JSON.stringify({ version: 1, nodes: { one: { name: "Árbol antiguo", content: "Texto original" } } }))
  const before = Array.from({ length: storage.length }, (_, i) => [storage.key(i), storage.getItem(storage.key(i)!)])
  const result = await store.migrate(storage)
  assert.equal(result.migrated, 2)
  assert.equal(result.archived, 4)
  assert.deepEqual((await reopen().read(context))?.workspace, pending)
  assert.equal((await store.read(context))?.r2.etag, "legacy")
  assert.ok(files.has(synthesisFolderPath(context).join("/")))
  assert.deepEqual(await store.listWeeks(other.subjectId), [19])
  assert.ok((await store.listCopies()).some((copy) => copy.version === 1 && copy.preview.includes("Texto original")))
  assert.deepEqual(Array.from({ length: storage.length }, (_, i) => [storage.key(i), storage.getItem(storage.key(i)!) ]), before)
  const count = files.size
  assert.equal((await reopen().migrate(storage)).migrated, 0)
  assert.equal(files.size, count)
})

test("a different folder document is never overwritten by stale browser data", async () => {
  const { store } = folderFixture()
  const current = notes("DB en carpeta")
  await store.save(context, current)
  const storage = browserStorage()
  storage.setItem(key, JSON.stringify(notes("DB vieja en navegador")))
  await store.migrate(storage)
  assert.deepEqual((await store.read(context))?.workspace, current)
  assert.ok((await store.listCopies()).some((copy) => copy.preview.includes("vieja")))
})

test("crash drafts recover only against their exact folder base and only once", async () => {
  const { store, reopen } = folderFixture()
  const base = notes("base")
  const draft = notes("DB antes del cierre")
  await store.save(context, base)
  const storage = browserStorage()
  storage.setItem(pendingKey, JSON.stringify({ workspace: draft, folderBase: synthesisContent(base) }))
  await store.migrate(storage)
  assert.deepEqual((await store.read(context))?.workspace, draft)
  await store.save(context, base)
  await reopen().migrate(storage)
  assert.deepEqual((await store.read(context))?.workspace, base)
})

test("a failed migration can retry and browser copies survive the failure", async () => {
  const { store, failWrites, reopen } = folderFixture()
  const storage = browserStorage()
  const raw = JSON.stringify(notes("DB que no debe perderse"))
  storage.setItem(key, raw)
  failWrites((path) => path.endsWith("workspace.json"))
  await assert.rejects(store.migrate(storage), /Permission revoked/)
  assert.equal(storage.getItem(key), raw)
  failWrites(null)
  await reopen().migrate(storage)
  assert.deepEqual((await store.read(context))?.workspace, JSON.parse(raw))
})

test("a corrupt pending copy is archived and a valid primary is still migrated", async () => {
  const { store } = folderFixture()
  const storage = browserStorage()
  const valid = notes("DB válida")
  storage.setItem(key, JSON.stringify(valid))
  storage.setItem(pendingKey, "{broken")
  await store.migrate(storage)
  assert.deepEqual((await store.read(context))?.workspace, valid)
  assert.ok((await store.listCopies()).some((copy) => copy.raw === "{broken"))
})

test("folder writes are verified, preserve backups, and image bytes survive reopening", async () => {
  const { store, files, corruptWrites, reopen } = folderFixture()
  const original = notes("DB original")
  await store.save(context, original)
  corruptWrites((path) => path.endsWith("workspace.json"))
  await assert.rejects(store.save(context, notes("nuevo")), /verificar/)
  assert.ok(files.has(synthesisFolderPath(context).slice(0, -1).concat("workspace.backup.json").join("/")))
  assert.ok((await store.listCopies()).some((copy) => copy.preview.includes("original")))
  corruptWrites(null)
  const blob = new Blob([new Uint8Array([1, 2, 3, 255])], { type: "image/png" })
  await store.saveImage("image-1", blob)
  const restored = await reopen().readImage("image-1")
  assert.equal(restored?.type, "image/png")
  assert.deepEqual(await restored!.arrayBuffer(), await blob.arrayBuffer())
})

test("subject and image paths reject directory traversal", async () => {
  const { store } = folderFixture()
  assert.throws(() => synthesisFolderPath({ subjectId: "../outside", weekNumber: 1 }))
  await assert.rejects(store.saveImage("../outside", new Blob(["x"], { type: "image/png" })), /Identificador/)
})

test("IndexedDB images migrate to real folder paths without deleting their originals", async () => {
  const { store, files, reopen } = folderFixture()
  const blob = new Blob(["original image bytes"], { type: "image/png" })
  const originals = new Map([ ["db-image", blob] ])
  const previous = Object.getOwnPropertyDescriptor(globalThis, "indexedDB")
  const request = (result: unknown) => {
    const value = { result, onsuccess: null as null | (() => void) }
    queueMicrotask(() => value.onsuccess?.())
    return value
  }
  const db = { close() {}, transaction() { return { objectStore() { return {
    getAllKeys: () => request([...originals.keys()]), get: (key: string) => request(originals.get(key)),
  } } } } }
  Object.defineProperty(globalThis, "indexedDB", { configurable: true, value: { open: () => request(db) } })
  try {
    await migrateSynthesisImagesToFolder(store)
    assert.equal(files.has("sintesis/images/db-image.png"), true)
    assert.equal(await (await reopen().readImage("db-image"))?.text(), "original image bytes")
    assert.equal(originals.get("db-image"), blob)
    const count = files.size
    await migrateSynthesisImagesToFolder(reopen())
    assert.equal(files.size, count)
  } finally {
    if (previous) Object.defineProperty(globalThis, "indexedDB", previous)
    else Reflect.deleteProperty(globalThis, "indexedDB")
  }
})
