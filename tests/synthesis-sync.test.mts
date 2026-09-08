import assert from "node:assert/strict"
import test from "node:test"
import { syncSynthesis, SYNTHESIS_SYNC_EVENT } from "../lib/client/synthesis-sync.ts"
import { createEmptySynthesisWorkspace, SYNTHESIS_WORKSPACE_STORAGE_KEY } from "../lib/synthesis-workspace.ts"
import { buildSynthesisLocalStorageKey } from "../lib/synthesis-context.ts"

test("R2 conserva cambios offline, reintenta, descarga y protege conflictos", async () => {
  const context = { subjectId: "sync-test", weekNumber: 1 }
  const key = buildSynthesisLocalStorageKey(SYNTHESIS_WORKSPACE_STORAGE_KEY, context)
  const values = new Map<string, string>()
  const originals = ["window", "localStorage", "fetch", "StorageEvent"].map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const)
  const target = new EventTarget()
  const errors: string[] = []
  target.addEventListener(SYNTHESIS_SYNC_EVENT, (event) => { const error = (event as CustomEvent).detail.error; if (error) errors.push(error) })
  Object.defineProperty(globalThis, "window", { configurable: true, value: target })
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value) } })
  Object.defineProperty(globalThis, "StorageEvent", { configurable: true, value: class extends Event { constructor(type: string, options: object) { super(type); Object.assign(this, options) } } })
  let offline = true
  let remote: ReturnType<typeof createEmptySynthesisWorkspace> | null = null
  let etag: string | null = null
  let writes = 0
  Object.defineProperty(globalThis, "fetch", { configurable: true, value: async (_url: string, init?: RequestInit) => {
    if (offline) throw new Error("offline")
    if (init?.method === "PUT") {
      const body = JSON.parse(String(init.body))
      assert.equal(body.etag, etag)
      remote = body.workspace
      etag = String(++writes)
    }
    return Response.json({ workspace: remote, etag })
  } })
  try {
    const original = JSON.stringify(createEmptySynthesisWorkspace())
    values.set(key, original)
    await syncSynthesis(context)
    assert.equal(values.get(key), original)
    assert.equal(values.has(key + ":r2-content"), false)
    assert.equal(errors.length, 1)
    offline = false
    await syncSynthesis(context)
    assert.equal(writes, 1)
    assert.equal(values.get(key + ":r2-content"), original)
    values.delete(key)
    await syncSynthesis(context)
    assert.equal(values.get(key), original)
    const changed = JSON.stringify({ ...JSON.parse(original), defaultScale: 1.5 })
    values.set(key, changed)
    etag = "another-device"
    await syncSynthesis(context)
    assert.equal(writes, 1)
    assert.equal(values.get(key), changed)
    assert.match(errors.at(-1)!, /otra versión/)
  } finally {
    for (const [name, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor)
      else Reflect.deleteProperty(globalThis, name)
    }
  }
})
