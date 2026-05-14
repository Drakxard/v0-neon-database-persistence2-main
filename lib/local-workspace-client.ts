"use client"

const WORKSPACE_DB_NAME = "local-workspace"
const WORKSPACE_DB_VERSION = 1
const WORKSPACE_STORE_NAME = "workspace"
const WORKSPACE_ROOT_KEY = "root-handle"

type WorkspaceRecord = {
  id: string
  handle: FileSystemDirectoryHandle
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
  return withStore<FileSystemDirectoryHandle | null>("readonly", (store) => {
    return new Promise<FileSystemDirectoryHandle | null>((resolve, reject) => {
      const request = store.get(WORKSPACE_ROOT_KEY)
      request.onsuccess = () => resolve((request.result as WorkspaceRecord | undefined)?.handle ?? null)
      request.onerror = () => reject(request.error ?? new Error("No se pudo leer la carpeta guardada."))
    })
  })
}

export async function persistWorkspaceHandle(handle: FileSystemDirectoryHandle) {
  return withStore<void>("readwrite", (store) => {
    store.put({
      id: WORKSPACE_ROOT_KEY,
      handle,
    } satisfies WorkspaceRecord)
  })
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
  await rootHandle.getDirectoryHandle("cronograma", { create: true })
  await rootHandle.getDirectoryHandle("teoria", { create: true })
  await rootHandle.getDirectoryHandle("practica", { create: true })
  await rootHandle.getDirectoryHandle("audio", { create: true })
  await rootHandle.getDirectoryHandle("manifests", { create: true })
}

export async function pickWorkspaceRootHandle() {
  const handle = await window.showDirectoryPicker({ mode: "readwrite" })
  const permission = await requestWorkspacePermission(handle, "readwrite")
  if (permission !== "granted") {
    throw new Error("Permiso denegado para la carpeta seleccionada.")
  }

  await ensureWorkspaceSubdirectories(handle)
  await persistWorkspaceHandle(handle)
  return handle
}

