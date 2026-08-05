"use client"

const WORKSPACE_DB_NAME = "local-workspace"
const WORKSPACE_DB_VERSION = 1
const WORKSPACE_STORE_NAME = "workspace"
const WORKSPACE_ROOT_KEY = "root-handle"
const LEGACY_INSCREEN_BROWSER_HALF_KEY = "inscreen-config-half"
export const INSCREEN_CONFIG_FILE_NAME = "User.InScreen"

type WorkspaceRecord = {
  id: string
  handle: FileSystemDirectoryHandle
}

let cachedWorkspaceHandle: FileSystemDirectoryHandle | null = null
let workspaceHandleLoad: Promise<FileSystemDirectoryHandle | null> | null = null
let readyWorkspaceHandle: FileSystemDirectoryHandle | null = null
let readyInscreenConfigHalf = ""

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

export function getReadyWorkspaceHandle() {
  return readyWorkspaceHandle
}

export function setReadyWorkspaceHandle(handle: FileSystemDirectoryHandle | null) {
  readyWorkspaceHandle = handle
  if (handle) cachedWorkspaceHandle = handle
  else readyInscreenConfigHalf = ""
}

export function getReadyInscreenConfigHalf() {
  return readyInscreenConfigHalf
}

export function setReadyInscreenConfigHalf(value: string) {
  readyInscreenConfigHalf = String(value || "")
}

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

