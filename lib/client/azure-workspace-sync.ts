import { AZURE_SYNC_FILE, AZURE_WORKSPACE_DIRECTORIES, AZURE_UPLOAD_CHUNK_SIZE, azureBlockId, azureWorkspaceId, azureWorkspacePath } from "../azure-workspace.ts"

export type AzureSyncStatus = { configured: boolean; connected?: boolean; account?: string; container?: string; target?: string; error?: string }
export type AzureSyncSummary = { synced: number; pending: number; failed: number; errors: string[]; workspaceId: string; activePath?: string }
type FileRecord = { hash: string; etag: string; size: number; modified: number }
type Manifest = { version: 1; workspaceId: string; target: string; files: Record<string, FileRecord> }
const running = new WeakMap<FileSystemDirectoryHandle, Promise<AzureSyncSummary>>()
let statusCache: { value: AzureSyncStatus; time: number } | undefined

export async function getAzureSyncStatus(refresh = false): Promise<AzureSyncStatus> {
  if (!refresh && statusCache && Date.now() - statusCache.time < 30_000) return statusCache.value
  const response = await fetch("/api/storage/azure", { cache: "no-store" })
  const value = await response.json()
  if (!response.ok) throw new Error(value.error || "No se pudo consultar Azure.")
  statusCache = { value, time: Date.now() }
  return value
}

async function handle(root: FileSystemDirectoryHandle, path: string, create = false) {
  const parts = path.split("/")
  let dir = root
  for (const part of parts.slice(0, -1)) dir = await dir.getDirectoryHandle(part, { create })
  return dir.getFileHandle(parts.at(-1)!, { create })
}

async function saveManifest(root: FileSystemDirectoryHandle, value: Manifest) {
  const file = await handle(root, `manifests/${AZURE_SYNC_FILE}`, true)
  const writer = await file.createWritable()
  try { await writer.write(JSON.stringify(value)); await writer.close() } catch (error) { await writer.abort().catch(() => {}); throw error }
}

async function manifest(root: FileSystemDirectoryHandle): Promise<Manifest> {
  try {
    const value = JSON.parse(await (await (await handle(root, `manifests/${AZURE_SYNC_FILE}`)).getFile()).text()) as Manifest
    azureWorkspaceId(value.workspaceId)
    if (value.version !== 1 || !value.files || typeof value.files !== "object") throw new Error("Manifiesto de Azure inválido.")
    return value
  } catch (error) {
    if ((error as { name?: string }).name !== "NotFoundError") throw error
    const value: Manifest = { version: 1, workspaceId: crypto.randomUUID(), target: "", files: {} }
    await saveManifest(root, value)
    return value
  }
}

export async function getAzureWorkspaceCode(root: FileSystemDirectoryHandle) { return (await manifest(root)).workspaceId }

export async function setAzureWorkspaceCode(root: FileSystemDirectoryHandle, code: string) {
  const workspaceId = azureWorkspaceId(code.trim())
  await withLock(async () => { await saveManifest(root, { version: 1, workspaceId, target: "", files: {} }) })
}

async function filesIn(dir: FileSystemDirectoryHandle, prefix: string): Promise<Array<{ path: string; file: File }>> {
  const files: Array<{ path: string; file: File }> = []
  for await (const [name, entry] of dir.entries()) {
    const path = `${prefix}/${name}`
    if (entry.kind === "directory") files.push(...await filesIn(entry as FileSystemDirectoryHandle, path))
    else {
      try { azureWorkspacePath(path) } catch { continue }
      files.push({ path, file: await (entry as FileSystemFileHandle).getFile() })
    }
  }
  return files
}

async function workspaceFiles(root: FileSystemDirectoryHandle) {
  const files: Array<{ path: string; file: File }> = []
  for (const name of AZURE_WORKSPACE_DIRECTORIES) {
    try { files.push(...await filesIn(await root.getDirectoryHandle(name), name)) }
    catch (error) { if ((error as { name?: string }).name !== "NotFoundError") throw error }
  }
  // Files that reference PDFs and explanations are uploaded after their content.
  return files.sort((a, b) => Number(a.path.endsWith(".json")) - Number(b.path.endsWith(".json")))
}

async function hash(blob: Blob) {
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", await blob.arrayBuffer())), byte => byte.toString(16).padStart(2, "0")).join("")
}

async function responseJson(response: Response) {
  const value = await response.json().catch(() => null)
  if (!response.ok) throw new Error(value?.error || `Azure respondió ${response.status}.`)
  return value
}

async function upload(workspaceId: string, path: string, file: File, contentHash: string, expectedEtag?: string) {
  const metadata = { workspaceId, path, hash: contentHash, expectedEtag }
  const prepared = await responseJson(await fetch("/api/storage/azure", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...metadata, action: "prepare" }) }))
  if (prepared.synced) return prepared.etag as string
  const blocks: string[] = [], sessionId = crypto.randomUUID()
  for (let offset = 0; offset < file.size; offset += AZURE_UPLOAD_CHUNK_SIZE) {
    const block = azureBlockId(sessionId, blocks.length)
    const query = new URLSearchParams({ workspaceId, path, block })
    await responseJson(await fetch(`/api/storage/azure?${query}`, { method: "PUT", headers: { "Content-Type": "application/octet-stream" }, body: file.slice(offset, offset + AZURE_UPLOAD_CHUNK_SIZE) }))
    blocks.push(block)
  }
  const committed = await responseJson(await fetch("/api/storage/azure", { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...metadata, expectedEtag: prepared.expectedEtag, action: "commit", blocks, contentType: file.type || "application/octet-stream" }) }))
  return committed.etag as string
}

async function withLock<T>(operation: () => Promise<T>): Promise<T> {
  return typeof navigator !== "undefined" && navigator.locks ? navigator.locks.request("cursado2026-azure-workspace", operation) : operation()
}

async function runSync(root: FileSystemDirectoryHandle, progress?: (value: AzureSyncSummary) => void) {
  const status = await getAzureSyncStatus()
  if (!status.configured || !status.connected || !status.target) throw new Error(status.error || "Azure no está configurado.")
  const state = await manifest(root)
  if (state.target !== status.target) { state.target = status.target; state.files = {}; await saveManifest(root, state) }
  const files = await workspaceFiles(root)
  const summary: AzureSyncSummary = { synced: 0, pending: files.length, failed: 0, errors: [], workspaceId: state.workspaceId }
  for (const { path, file } of files) {
    summary.activePath = path
    progress?.({ ...summary })
    try {
      const previous = state.files[path]
      if (!previous || previous.size !== file.size || previous.modified !== file.lastModified) {
        const contentHash = await hash(file)
        const etag = previous?.hash === contentHash ? previous.etag : await upload(state.workspaceId, path, file, contentHash, previous?.etag)
        if (!etag) throw new Error("Azure no confirmó la versión del archivo.")
        state.files[path] = { hash: contentHash, etag, size: file.size, modified: file.lastModified }
        await saveManifest(root, state)
      }
      summary.synced++
    } catch (error) {
      summary.failed++
      if (summary.errors.length < 5) summary.errors.push(`${path}: ${error instanceof Error ? error.message : "Error de sincronización."}`)
    }
    summary.pending--
  }
  delete summary.activePath
  progress?.({ ...summary })
  return summary
}

export function syncLocalWorkspaceToAzure(root: FileSystemDirectoryHandle, progress?: (value: AzureSyncSummary) => void) {
  const existing = running.get(root)
  if (existing) return existing
  const promise = withLock(() => runSync(root, progress)).finally(() => running.delete(root))
  running.set(root, promise)
  return promise
}

export async function restoreMissingAzureFiles(root: FileSystemDirectoryHandle) {
  return withLock(async () => {
    const status = await getAzureSyncStatus(true)
    if (!status.connected || !status.target) throw new Error(status.error || "Azure no está conectado.")
    const state = await manifest(root)
    const query = new URLSearchParams({ workspaceId: state.workspaceId })
    const remote = await responseJson(await fetch(`/api/storage/azure/files?${query}`, { cache: "no-store" }))
    let restored = 0, skipped = 0
    for (const entry of remote.files as Array<{ path: string; etag: string; hash?: string }>) {
      azureWorkspacePath(entry.path)
      const existing = await handle(root, entry.path).catch(error => { if (error.name === "NotFoundError") return null; throw error })
      if (existing) { skipped++; continue }
      const response = await fetch(`/api/storage/azure/files?${new URLSearchParams({ workspaceId: state.workspaceId, path: entry.path })}`, { cache: "no-store" })
      if (!response.ok || !response.body) throw new Error(`No se pudo recuperar ${entry.path}.`)
      const fileHandle = await handle(root, entry.path, true)
      const writer = await fileHandle.createWritable()
      try { await response.body.pipeTo(writer) } catch (error) { await writer.abort().catch(() => {}); throw error }
      const file = await fileHandle.getFile(), fingerprint = await hash(file)
      if (entry.hash && entry.hash !== fingerprint) throw new Error(`La huella de ${entry.path} no coincide con el respaldo.`)
      state.files[entry.path] = { hash: fingerprint, etag: entry.etag, size: file.size, modified: file.lastModified }
      restored++
    }
    state.target = status.target
    await saveManifest(root, state)
    return { restored, skipped }
  })
}
