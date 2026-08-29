"use client"

const WORKSPACE_DB_NAME = "local-workspace"
const WORKSPACE_DB_VERSION = 1
const WORKSPACE_STORE_NAME = "workspace"
const WORKSPACE_ROOT_KEY = "root-handle"
const LEGACY_INSCREEN_BROWSER_HALF_KEY = "inscreen-config-half"
export const INSCREEN_CONFIG_FILE_NAME = "User.InScreen"
export const DRIVE_CONFIG_FILE_NAME = "User.Drive"
export const SERVICES_FILE_NAME = "User.Services"
export const SERVICES_BACKUP_FILE_NAME = "User.Services.backup"

export type ServicesFileV1 = {
  version: 1
  inscreenToken: string
  driveToken: string
  seedFingerprint: string
  savedAt: string
  validatedAt: string
}

type WorkspaceRecord = {
  id: string
  handle: FileSystemDirectoryHandle
}

let cachedWorkspaceHandle: FileSystemDirectoryHandle | null = null
let workspaceHandleLoad: Promise<FileSystemDirectoryHandle | null> | null = null
let readyWorkspaceHandle: FileSystemDirectoryHandle | null = null
let readyInscreenConfigToken = ""
let readyDriveConfigToken = ""

function normalizeServicesFile(value: unknown): ServicesFileV1 {
  const input = value && typeof value === "object" ? value as Record<string, unknown> : {}
  if (input.version !== 1) throw new Error("User.Services tiene una version no compatible.")
  const result: ServicesFileV1 = {
    version: 1,
    inscreenToken: String(input.inscreenToken || "").trim(),
    driveToken: String(input.driveToken || "").trim(),
    seedFingerprint: String(input.seedFingerprint || "").trim(),
    savedAt: String(input.savedAt || "").trim(),
    validatedAt: String(input.validatedAt || "").trim(),
  }
  if (!result.inscreenToken && !result.driveToken) throw new Error("User.Services no contiene ningun servicio.")
  if (result.inscreenToken.length > 12_000 || result.driveToken.length > 12_000) throw new Error("User.Services excede el tamano permitido.")
  if (!Number.isFinite(Date.parse(result.savedAt))) throw new Error("User.Services no tiene una fecha valida.")
  return result
}

async function readServicesFileByName(rootHandle: FileSystemDirectoryHandle, name: string) {
  const handle = await rootHandle.getFileHandle(name)
  return normalizeServicesFile(JSON.parse(await (await handle.getFile()).text()))
}

export async function loadServicesFile(rootHandle: FileSystemDirectoryHandle) {
  try {
    return await readServicesFileByName(rootHandle, SERVICES_FILE_NAME)
  } catch (error) {
    if (error instanceof DOMException && error.name === "NotFoundError") return null
    try { return await readServicesFileByName(rootHandle, SERVICES_BACKUP_FILE_NAME) }
    catch { throw error }
  }
}

async function writeTextFile(rootHandle: FileSystemDirectoryHandle, name: string, contents: string) {
  const handle = await rootHandle.getFileHandle(name, { create: true })
  const writable = await handle.createWritable()
  try { await writable.write(contents) } finally { await writable.close() }
}

export async function persistServicesFile(rootHandle: FileSystemDirectoryHandle, input: Omit<ServicesFileV1, "version" | "savedAt"> & { savedAt?: string }) {
  const current = await readServicesFileByName(rootHandle, SERVICES_FILE_NAME).catch(() => null)
  if (current) await writeTextFile(rootHandle, SERVICES_BACKUP_FILE_NAME, JSON.stringify(current, null, 2))
  const next = normalizeServicesFile({ ...input, version: 1, savedAt: input.savedAt || new Date().toISOString() })
  await writeTextFile(rootHandle, SERVICES_FILE_NAME, JSON.stringify(next, null, 2))
  const verified = await readServicesFileByName(rootHandle, SERVICES_FILE_NAME)
  if (JSON.stringify(verified) !== JSON.stringify(next)) throw new Error("User.Services se escribio, pero no pudo verificarse.")
  return verified
}

export async function removeLegacyServiceFiles(rootHandle: FileSystemDirectoryHandle, services: { inscreen: boolean; drive: boolean }) {
  const names = [services.inscreen ? INSCREEN_CONFIG_FILE_NAME : "", services.drive ? DRIVE_CONFIG_FILE_NAME : ""].filter(Boolean)
  for (const name of names) {
    try { await rootHandle.removeEntry(name) } catch (error) {
      if (!(error instanceof DOMException && error.name === "NotFoundError")) throw error
    }
  }
}

export async function removeServicesFile(rootHandle: FileSystemDirectoryHandle) {
  try { await rootHandle.removeEntry(SERVICES_FILE_NAME) } catch (error) {
    if (!(error instanceof DOMException && error.name === "NotFoundError")) throw error
  }
}

function openWorkspaceDb() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = window.indexedDB.open(WORKSPACE_DB_NAME, WORKSPACE_DB_VERSION)

    request.onupgradeneeded = () => {
      const database = request.result
      if (!database.objectStoreNames.contains(WORKSPACE_STORE_NAME)) {
        database.createObjectStore(WORKSPACE_STORE_NAME, { keyPath: "id" })
      }
    }

    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error("No se pudo abrir IndexedDB."))
  })
}

async function withStore<T>(mode: IDBTransactionMode, handler: (store: IDBObjectStore) => void | Promise<T>) {
  const database = await openWorkspaceDb()

  try {
    return await new Promise<T>((resolve, reject) => {
      const transaction = database.transaction(WORKSPACE_STORE_NAME, mode)
      const store = transaction.objectStore(WORKSPACE_STORE_NAME)

      Promise.resolve(handler(store))
        .then((result) => {
          transaction.oncomplete = () => resolve(result as T)
          transaction.onerror = () => reject(transaction.error ?? new Error("No se pudo completar la transaccion."))
          transaction.onabort = () => reject(transaction.error ?? new Error("La transaccion fue abortada."))
        })
        .catch(reject)
    })
  } finally {
    database.close()
  }
}

export function supportsWorkspacePicker() {
  return typeof window !== "undefined" && "showDirectoryPicker" in window
}

export async function loadWorkspaceHandle() {
  if (cachedWorkspaceHandle) return cachedWorkspaceHandle
  if (workspaceHandleLoad) return workspaceHandleLoad

  workspaceHandleLoad = withStore<FileSystemDirectoryHandle | null>("readonly", (store) => {
    return new Promise<FileSystemDirectoryHandle | null>((resolve, reject) => {
      const request = store.get(WORKSPACE_ROOT_KEY)
      request.onsuccess = () => resolve((request.result as WorkspaceRecord | undefined)?.handle ?? null)
      request.onerror = () => reject(request.error ?? new Error("No se pudo leer la carpeta guardada."))
    })
  })

  try {
    cachedWorkspaceHandle = await workspaceHandleLoad
    return cachedWorkspaceHandle
  } finally {
    workspaceHandleLoad = null
  }
}

export async function persistWorkspaceHandle(handle: FileSystemDirectoryHandle) {
  await withStore<void>("readwrite", (store) => {
    store.put({
      id: WORKSPACE_ROOT_KEY,
      handle,
    } satisfies WorkspaceRecord)
  })
  cachedWorkspaceHandle = handle
}

export async function clearLegacyInscreenBrowserHalf() {
  await withStore<void>("readwrite", (store) => {
    store.delete(LEGACY_INSCREEN_BROWSER_HALF_KEY)
  })
}

export async function loadInscreenFileHalf(rootHandle: FileSystemDirectoryHandle) {
  try {
    const handle = await rootHandle.getFileHandle(INSCREEN_CONFIG_FILE_NAME)
    const file = await handle.getFile()
    const parsed = JSON.parse(await file.text()) as { version?: number; half?: string }
    return parsed.version === 2 ? String(parsed.half || "") : ""
  } catch (error) {
    if (error instanceof DOMException && error.name === "NotFoundError") return ""
    throw error
  }
}

export async function persistInscreenFileHalf(rootHandle: FileSystemDirectoryHandle, half: string) {
  const handle = await rootHandle.getFileHandle(INSCREEN_CONFIG_FILE_NAME, { create: true })
  const writable = await handle.createWritable()
  try {
    await writable.write(JSON.stringify({ version: 2, half }, null, 2))
  } finally {
    await writable.close()
  }
}

export async function loadDriveFileHalf(rootHandle: FileSystemDirectoryHandle) {
  try {
    const handle = await rootHandle.getFileHandle(DRIVE_CONFIG_FILE_NAME)
    const parsed = JSON.parse(await (await handle.getFile()).text()) as { version?: number; half?: string }
    return parsed.version === 1 ? String(parsed.half || "") : ""
  } catch (error) {
    if (error instanceof DOMException && error.name === "NotFoundError") return ""
    throw error
  }
}

export async function persistDriveFileHalf(rootHandle: FileSystemDirectoryHandle, half: string) {
  const handle = await rootHandle.getFileHandle(DRIVE_CONFIG_FILE_NAME, { create: true })
  const writable = await handle.createWritable()
  try { await writable.write(JSON.stringify({ version: 1, half }, null, 2)) } finally { await writable.close() }
}

export async function removeDriveFileHalf(rootHandle: FileSystemDirectoryHandle) {
  try { await rootHandle.removeEntry(DRIVE_CONFIG_FILE_NAME) } catch (error) {
    if (!(error instanceof DOMException && error.name === "NotFoundError")) throw error
  }
}

export function getReadyWorkspaceHandle() {
  return readyWorkspaceHandle
}

export function setReadyWorkspaceHandle(handle: FileSystemDirectoryHandle | null) {
  readyWorkspaceHandle = handle
  if (handle) cachedWorkspaceHandle = handle
  else {
    readyInscreenConfigToken = ""
    readyDriveConfigToken = ""
  }
}

export function getReadyInscreenConfigToken() {
  return readyInscreenConfigToken
}

export function setReadyInscreenConfigToken(value: string) {
  readyInscreenConfigToken = String(value || "")
}

export function getReadyDriveConfigToken() { return readyDriveConfigToken }
export function setReadyDriveConfigToken(value: string) { readyDriveConfigToken = String(value || "") }

export async function queryWorkspacePermission(handle: FileSystemDirectoryHandle, mode: FileSystemPermissionMode = "readwrite") {
  try {
    return await handle.queryPermission({ mode })
  } catch {
    return "prompt" as PermissionState
  }
}

export async function requestWorkspacePermission(handle: FileSystemDirectoryHandle, mode: FileSystemPermissionMode = "readwrite") {
  try {
    return await handle.requestPermission({ mode })
  } catch {
    return "denied" as PermissionState
  }
}

export async function ensureWorkspaceSubdirectories(rootHandle: FileSystemDirectoryHandle) {
  await Promise.all(
    ["cronograma", "teoria", "practica", "audio", "manifests"].map((directoryName) =>
      rootHandle.getDirectoryHandle(directoryName, { create: true })
    )
  )
}

export async function pickWorkspaceRootHandle() {
  const handle = await window.showDirectoryPicker({ mode: "readwrite" })
  const permission = await requestWorkspacePermission(handle, "readwrite")
  if (permission !== "granted") {
    throw new Error("Permiso denegado para la carpeta seleccionada.")
  }

  await ensureWorkspaceSubdirectories(handle)
  await persistWorkspaceHandle(handle)
  setReadyWorkspaceHandle(handle)
  return handle
}

