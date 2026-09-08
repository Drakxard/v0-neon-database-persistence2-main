import { parseSynthesisContext, buildSynthesisLocalStorageKey, type SynthesisContext } from "../synthesis-context.ts"
import { assertValidSynthesisWorkspace, SYNTHESIS_WORKSPACE_PENDING_KEY, SYNTHESIS_WORKSPACE_STORAGE_KEY, type SynthesisWorkspaceV2 } from "../synthesis-workspace.ts"
import { findSynthesisLocalCopies, parseStoredSynthesisWorkspace, type SynthesisLocalCopy } from "./synthesis-local-copies.ts"

export type FolderSynthesis = {
  version: 1
  workspace: SynthesisWorkspaceV2
  r2: { etag: string | null; baseline: SynthesisWorkspaceV2 | null }
}
const ROOT = ["manifests", "sintesis"]
const missing = (error: unknown) => error instanceof Error && error.name === "NotFoundError"
export const synthesisContent = (value: SynthesisWorkspaceV2 | null) => value ? JSON.stringify(value) : null

export function synthesisFolderPath(context: SynthesisContext) {
  const scope = parseSynthesisContext(context.subjectId, context.weekNumber)
  return [...ROOT, scope.subjectId, `semana-${scope.weekNumber}`, "workspace.json"]
}

/** Uses only the directory handle explicitly authorized by the user. */
export function createSynthesisFolderStore(root: FileSystemDirectoryHandle) {
  const queues = new Map<string, Promise<unknown>>()
  async function lock<T>(name: string, operation: () => Promise<T>): Promise<T> {
    const previous = queues.get(name) ?? Promise.resolve()
    const next = previous.catch(() => undefined).then(() => typeof navigator !== "undefined" && navigator.locks
      ? navigator.locks.request(`synthesis-folder:${name}`, operation) : operation())
    queues.set(name, next)
    try { return await next } finally { if (queues.get(name) === next) queues.delete(name) }
  }
  async function directory(parts: string[], create = false) {
    let handle = root
    for (const part of parts) {
      if (!part || part === "." || part === ".." || /[\\/]/.test(part)) throw new Error("Ruta de Síntesis inválida.")
      handle = await handle.getDirectoryHandle(part, { create })
    }
    return handle
  }
  async function readText(path: string[]): Promise<string | null> {
    try { return await (await (await directory(path.slice(0, -1))).getFileHandle(path.at(-1)!)).getFile().then((file) => file.text()) }
    catch (error) { if (missing(error)) return null; throw error }
  }
  async function writeBlob(path: string[], value: Blob | string) {
    const file = await (await directory(path.slice(0, -1), true)).getFileHandle(path.at(-1)!, { create: true })
    const writable = await file.createWritable()
    try { await writable.write(value); await writable.close() }
    catch (error) { await writable.abort().catch(() => undefined); throw error }
    const readback = await file.getFile()
    const expected = typeof value === "string" ? new Blob([value]) : value
    const [writtenHash, expectedHash] = await Promise.all([digest(await readback.arrayBuffer()), digest(await expected.arrayBuffer())])
    if (writtenHash !== expectedHash) throw new Error("No se pudo verificar el guardado de Síntesis en la carpeta.")
  }
  async function digest(bytes: BufferSource) {
    return Array.from(new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", bytes)), (byte) => byte.toString(16).padStart(2, "0")).join("")
  }
  async function archive(sourceKey: string, raw: string, kind = "copias") {
    const hash = await digest(new TextEncoder().encode(JSON.stringify([sourceKey, raw])))
    const path = [...ROOT, kind, `${hash}.json`]
    const existing = await readText(path)
    if (existing !== null && existing !== "") {
      const value = JSON.parse(existing)
      if (value.sourceKey !== sourceKey || value.raw !== raw) throw new Error("Una copia de Síntesis no pasó la verificación.")
      return false
    }
    await writeBlob(path, JSON.stringify({ sourceKey, raw, savedAt: new Date().toISOString() }, null, 2))
    return true
  }
  async function read(context: SynthesisContext): Promise<FolderSynthesis | null> {
    const raw = await readText(synthesisFolderPath(context))
    if (raw === null || raw === "") return null
    const record = JSON.parse(raw) as FolderSynthesis
    if (record.version !== 1 || !record.r2 || !(record.r2.etag === null || typeof record.r2.etag === "string")) throw new Error("El archivo de Síntesis tiene un formato inválido.")
    assertValidSynthesisWorkspace(record.workspace)
    if (record.r2.baseline) assertValidSynthesisWorkspace(record.r2.baseline)
    return record
  }
  async function commit(context: SynthesisContext, record: FolderSynthesis) {
    assertValidSynthesisWorkspace(record.workspace)
    const path = synthesisFolderPath(context)
    const previous = await readText(path)
    const serialized = JSON.stringify(record, null, 2)
    if (previous === serialized) return
    if (previous) {
      await archive(path.join("/"), previous)
      await writeBlob([...path.slice(0, -1), "workspace.backup.json"], previous)
    }
    await writeBlob(path, serialized)
  }
  async function save(context: SynthesisContext, workspace: SynthesisWorkspaceV2) {
    const snapshot = structuredClone(workspace)
    assertValidSynthesisWorkspace(snapshot)
    return lock(synthesisFolderPath(context).join("/"), async () => {
      const current = await read(context)
      await commit(context, { version: 1, workspace: snapshot, r2: current?.r2 ?? { etag: null, baseline: null } })
    })
  }
  async function acceptRemote(context: SynthesisContext, workspace: SynthesisWorkspaceV2, etag: string | null, expected: string | null) {
    return lock(synthesisFolderPath(context).join("/"), async () => {
      const current = await read(context)
      if (synthesisContent(current?.workspace ?? null) !== expected) return false
      await commit(context, { version: 1, workspace, r2: { etag, baseline: workspace } })
      return true
    })
  }
  async function acknowledgeUpload(context: SynthesisContext, uploaded: SynthesisWorkspaceV2, etag: string | null) {
    return lock(synthesisFolderPath(context).join("/"), async () => {
      const current = await read(context)
      if (!current) throw new Error("No se encontró el guardado local después de subirlo a R2.")
      await commit(context, { ...current, r2: { etag, baseline: uploaded } })
    })
  }
  async function migrate(storage: Storage) {
    return lock("browser-migration", async () => {
      const copies = findSynthesisLocalCopies(storage)
      const fresh = new Set<string>()
      // Archive every version, including unscoped v1 trees and damaged snapshots, first.
      for (const copy of copies) {
        if (await archive(copy.key, copy.raw, "migracion-navegador")) fresh.add(copy.key)
      }
      const contexts = new Map<string, SynthesisContext>()
      for (const copy of copies) {
        if (copy.version !== 2 || copy.subjectId === null || copy.weekNumber === null) continue
        try {
          const context = parseSynthesisContext(copy.subjectId, copy.weekNumber)
          contexts.set(synthesisFolderPath(context).join("/"), context)
        } catch { /* Unusable scopes remain in the archive, without guessing a subject. */ }
      }
      let migrated = 0
      for (const [path, context] of contexts) {
        await lock(path, async () => {
          const primaryKey = buildSynthesisLocalStorageKey(SYNTHESIS_WORKSPACE_STORAGE_KEY, context)
          const pendingKey = buildSynthesisLocalStorageKey(SYNTHESIS_WORKSPACE_PENDING_KEY, context)
          const pending = copies.find((copy) => copy.key === pendingKey)
          const primary = copies.find((copy) => copy.key === primaryKey)
          const valid = [pending, primary].flatMap((copy) => {
            if (!copy) return []
            try { return [{ copy, parsed: parseStoredSynthesisWorkspace(copy.raw) }] } catch { return [] }
          })
          if (!valid.length) return
          const { copy: selected, parsed } = valid[0]
          const appliedPath = [...ROOT, "migracion-aplicada", `${await digest(new TextEncoder().encode(JSON.stringify([selected.key, selected.raw])))}.json`]
          const current = await read(context)
          const envelope = JSON.parse(selected.raw)
          if (current) {
            // Only a new crash-recovery draft based on this exact file may replace it.
            if (selected.key !== pendingKey || await readText(appliedPath) !== null || envelope.folderBase !== synthesisContent(current.workspace)) return
            await commit(context, { ...current, workspace: parsed.workspace })
          } else {
            let baseline: SynthesisWorkspaceV2 | null = null
            const baselineRaw = storage.getItem(primaryKey + ":r2-content")
            if (baselineRaw) { try { baseline = parseStoredSynthesisWorkspace(baselineRaw).workspace } catch { /* Keep the archived raw copy. */ } }
            await commit(context, { version: 1, workspace: parsed.workspace, r2: {
              etag: storage.getItem(primaryKey + ":r2-etag") || parsed.etag, baseline,
            } })
          }
          await writeBlob(appliedPath, JSON.stringify({ sourceKey: selected.key, migratedAt: new Date().toISOString() }))
          migrated++
        })
      }
      return { archived: fresh.size, migrated }
    })
  }
  async function listWeeks(subjectId: string) {
    parseSynthesisContext(subjectId, 0)
    try {
      const handle = await directory([...ROOT, subjectId])
      const weeks: number[] = []
      for await (const [name, entry] of handle.entries()) {
        const match = /^semana-(\d+)$/.exec(name)
        if (entry.kind === "directory" && match && Number(match[1]) <= 9999) weeks.push(Number(match[1]))
      }
      return weeks.sort((a, b) => b - a)
    } catch (error) { if (missing(error)) return []; throw error }
  }
  async function listArchived(kind: string): Promise<SynthesisLocalCopy[]> {
    const result: SynthesisLocalCopy[] = []
    let handle: FileSystemDirectoryHandle
    try { handle = await directory([...ROOT, kind]) } catch (error) { if (missing(error)) return result; throw error }
    for await (const [name, entry] of handle.entries()) {
      if (entry.kind !== "file" || !name.endsWith(".json")) continue
      const archived = JSON.parse(await (await (entry as FileSystemFileHandle).getFile()).text())
      const syntheticKey = `inscreen:synthesis:recovery:${kind}/${name}`
      const value = JSON.stringify({ sourceKey: archived.sourceKey, raw: archived.raw })
      result.push(...findSynthesisLocalCopies({ length: 1, key: () => syntheticKey, getItem: () => value }))
    }
    return result
  }
  async function listCopies(): Promise<SynthesisLocalCopy[]> {
    return (await Promise.all(["migracion-navegador", "copias"].map(listArchived))).flat()
  }
  async function trash(context: SynthesisContext, workspace: SynthesisWorkspaceV2) {
    assertValidSynthesisWorkspace(workspace)
    return lock(synthesisFolderPath(context).join("/"), () => archive(synthesisFolderPath(context).join("/"), JSON.stringify(workspace), "papelera"))
  }
  // Older deletes predate the explicit trash. Previous saved versions are kept
  // here too so they remain recoverable from the same place.
  const listTrash = async () => (await Promise.all([listArchived("papelera"), listArchived("copias")])).flat()
  const imageTypes = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif" } as const
  function imageId(id: string) { if (!/^[A-Za-z0-9_-]{1,160}$/.test(id)) throw new Error("Identificador de imagen inválido."); return id }
  async function saveImage(id: string, blob: Blob) {
    const extension = imageTypes[blob.type as keyof typeof imageTypes]
    if (!extension) throw new Error("Formato de imagen de Síntesis no compatible.")
    await writeBlob(["sintesis", "images", `${imageId(id)}.${extension}`], blob)
  }
  async function readImage(id: string) {
    for (const [mimeType, extension] of Object.entries(imageTypes)) {
      try {
        const handle = await (await directory(["sintesis", "images"])).getFileHandle(`${imageId(id)}.${extension}`)
        return new Blob([await (await handle.getFile()).arrayBuffer()], { type: mimeType })
      } catch (error) { if (!missing(error)) throw error }
    }
    return null
  }
  return { read, save, acceptRemote, acknowledgeUpload, migrate, listWeeks, listCopies, trash, listTrash, saveImage, readImage, archive }
}
export type SynthesisFolderStore = ReturnType<typeof createSynthesisFolderStore>
