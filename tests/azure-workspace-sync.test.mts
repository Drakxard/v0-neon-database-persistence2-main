import assert from "node:assert/strict"
import test from "node:test"
import { AZURE_UPLOAD_CHUNK_SIZE, azureBlockId, azureWorkspacePath } from "../lib/azure-workspace.ts"
import { azureWorkspacePrefix, azureStorageFailure } from "../lib/server/azure-storage.ts"
import { getAzureSyncStatus, getAzureWorkspaceCode, setAzureWorkspaceCode, syncLocalWorkspaceToAzure, restoreMissingAzureFiles } from "../lib/client/azure-workspace-sync.ts"

function folder() {
  const files = new Map<string, File>(), dirs = new Set([""])
  const missing = () => new DOMException("No existe", "NotFoundError")
  const directory = (prefix: string): FileSystemDirectoryHandle => ({
    kind: "directory", name: prefix || "test",
    async getDirectoryHandle(name: string, options?: { create?: boolean }) {
      const path = prefix ? `${prefix}/${name}` : name
      if (!dirs.has(path) && !options?.create) throw missing()
      dirs.add(path); return directory(path)
    },
    async getFileHandle(name: string, options?: { create?: boolean }) {
      const path = prefix ? `${prefix}/${name}` : name
      if (!files.has(path)) { if (!options?.create) throw missing(); files.set(path, new File([], name)) }
      return { kind: "file", name, getFile: async () => files.get(path)!, async createWritable() {
        const values: BlobPart[] = []
        const writer = new WritableStream({ write(value) { values.push(typeof value === "string" ? value : value as BlobPart) }, close() { files.set(path, new File(values, name)) } })
        return Object.assign(writer, { async write(value: BlobPart) { values.push(value) }, async close() { files.set(path, new File(values, name)) }, async abort() {} })
      } }
    },
    async *entries() {
      const start = prefix ? `${prefix}/` : ""
      for (const path of dirs) if (path !== prefix && path.startsWith(start) && !path.slice(start.length).includes("/")) yield [path.slice(start.length), directory(path)]
      for (const path of files.keys()) if (path.startsWith(start) && !path.slice(start.length).includes("/")) yield [path.slice(start.length), await directory(prefix).getFileHandle(path.slice(start.length))]
    },
  }) as unknown as FileSystemDirectoryHandle
  const root = directory("")
  const put = async (path: string, data: BlobPart) => {
    const parts = path.split("/"); let dir = root
    for (const part of parts.slice(0, -1)) dir = await dir.getDirectoryHandle(part, { create: true })
    const writer = await (await dir.getFileHandle(parts.at(-1)!, { create: true })).createWritable()
    await writer.write(data); await writer.close()
  }
  return { root, files, put }
}

function remoteStorage() {
  const remote = new Map<string, { bytes: Blob; hash: string; etag: string }>(), blocks = new Map<string, Blob>()
  const calls: Array<{ method: string; path: string; bytes?: number }> = []
  let revision = 0
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(String(input), "https://test.local"), method = init?.method || "GET"
    calls.push({ method, path: url.pathname })
    if (url.pathname.endsWith("/files")) {
      const prefix = url.searchParams.get("workspaceId") + "/", path = url.searchParams.get("path")
      if (path) return new Response(remote.get(prefix + path)!.bytes)
      return Response.json({ files: [...remote].filter(([key]) => key.startsWith(prefix)).map(([key, value]) => ({ path: key.slice(prefix.length), hash: value.hash, etag: value.etag })) })
    }
    if (method === "GET") return Response.json({ configured: true, connected: true, target: "test", account: "test" })
    if (method === "PUT") {
      const blob = init!.body as Blob
      calls.at(-1)!.bytes = blob.size
      blocks.set(url.searchParams.get("block")!, blob)
      return Response.json({ uploaded: true })
    }
    const body = JSON.parse(String(init?.body)), key = body.workspaceId + "/" + body.path
    const existing = remote.get(key)
    if (body.action === "prepare") {
      if (existing?.hash === body.hash) return Response.json({ synced: true, etag: existing.etag })
      if (existing && existing.etag !== body.expectedEtag) return Response.json({ error: "El archivo cambió en Azure" }, { status: 409 })
      return Response.json({ synced: false, expectedEtag: existing?.etag })
    }
    const bytes = new Blob(body.blocks.map((block: string) => blocks.get(block)!)), etag = `version-${++revision}`
    remote.set(key, { bytes, hash: body.hash, etag })
    return Response.json({ synced: true, etag })
  }
  return { remote, calls, fetcher }
}

test("Azure paths exclude secrets and sync journals and keep accounts/workspaces isolated", () => {
  const id = crypto.randomUUID()
  assert.equal(azureWorkspacePath("manifests/pdf-explanations/id/demo.html"), "manifests/pdf-explanations/id/demo.html")
  for (const path of ["User.Services", "manifests/User.Services", "manifests/azure-sync.json", "manifests/drive-sync.json", "teoria/../secret", "teoria\\secret", "teoria//file"]) assert.throws(() => azureWorkspacePath(path))
  assert.notEqual(azureWorkspacePrefix("one@test", id), azureWorkspacePrefix("two@test", id))
  assert.notEqual(azureWorkspacePrefix("one@test", id), azureWorkspacePrefix("one@test", crypto.randomUUID()))
  assert.match(azureBlockId(id, 0), /^[A-Za-z0-9+/]{58}==$/)
  assert.ok(!azureStorageFailure({ message: "AccountKey=secret" }).includes("secret"))
})

test("Azure sync uploads PDFs in bounded blocks, includes explanations, skips unchanged files and retries conflicts", async t => {
  const storage = remoteStorage(), original = globalThis.fetch
  globalThis.fetch = storage.fetcher; t.after(() => { globalThis.fetch = original })
  await getAzureSyncStatus(true)
  const local = folder()
  await local.put("teoria/tema/documento.pdf", new Uint8Array(AZURE_UPLOAD_CHUNK_SIZE + 12))
  await local.put("manifests/pdf-explanations/id/demo.html", "<html>Explicación</html>")
  await local.put("manifests/subject-voice/transcription.json", '{"text":"Página"}')
  await local.put("User.Services", "private-token")
  await local.put("manifests/drive-sync.json", "old-drive")
  const first = await syncLocalWorkspaceToAzure(local.root)
  assert.equal(first.synced, 3); assert.equal(first.failed, 0)
  const uploads = storage.calls.filter(call => call.method === "PUT")
  assert.equal(uploads.length, 4)
  assert.ok(uploads.every(call => call.bytes! <= AZURE_UPLOAD_CHUNK_SIZE))
  await syncLocalWorkspaceToAzure(local.root)
  assert.equal(storage.calls.filter(call => call.method === "PUT").length, uploads.length)
  const key = first.workspaceId + "/manifests/pdf-explanations/id/demo.html"
  storage.remote.get(key)!.etag = "another-device"
  await local.put("manifests/pdf-explanations/id/demo.html", "Changed local explanation")
  const conflict = await syncLocalWorkspaceToAzure(local.root)
  assert.equal(conflict.failed, 1)
  assert.ok(conflict.errors[0].includes("cambió en Azure"))
  assert.equal(await storage.remote.get(key)!.bytes.text(), "<html>Explicación</html>")
})

test("recovery downloads missing files and preserves existing local content", async t => {
  const storage = remoteStorage(), original = globalThis.fetch
  globalThis.fetch = storage.fetcher; t.after(() => { globalThis.fetch = original })
  await getAzureSyncStatus(true)
  const source = folder()
  await source.put("teoria/materia/test.pdf", "PDF bytes")
  await source.put("manifests/pdf-explanations/id/demo.html", "Original remote")
  await syncLocalWorkspaceToAzure(source.root)
  const destination = folder()
  await destination.put("manifests/pdf-explanations/id/demo.html", "Keep local")
  await setAzureWorkspaceCode(destination.root, await getAzureWorkspaceCode(source.root))
  const result = await restoreMissingAzureFiles(destination.root)
  assert.deepEqual(result, { restored: 1, skipped: 1 })
  assert.equal(await destination.files.get("teoria/materia/test.pdf")!.text(), "PDF bytes")
  assert.equal(await destination.files.get("manifests/pdf-explanations/id/demo.html")!.text(), "Keep local")
})
