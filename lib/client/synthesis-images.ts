import { SYNTHESIS_LOCAL_IMAGE_PREFIX, SYNTHESIS_MAX_IMAGE_BYTES } from "../synthesis-workspace.ts"
import { getSynthesisFolderStore } from "./synthesis-persistence.ts"
import type { SynthesisFolderStore } from "./synthesis-folder-store.ts"

const DB_NAME = "cursado-synthesis-images-v1"
const STORE_NAME = "images"
const ALLOWED_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"])

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1)
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) request.result.createObjectStore(STORE_NAME)
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error("No se pudo abrir el almacenamiento de imágenes."))
  })
}

export async function saveSynthesisImage(file: File, onProgress?: (event: { progress: number }) => void, signal?: AbortSignal) {
  if (!ALLOWED_TYPES.has(file.type)) throw new Error("Usá una imagen PNG, JPEG, WebP o GIF.")
  if (file.size > SYNTHESIS_MAX_IMAGE_BYTES) throw new Error("La imagen supera el límite de 5 MB.")
  if (signal?.aborted) throw new Error("Carga cancelada.")
  const id = crypto.randomUUID()
  const folder = await getSynthesisFolderStore()
  if (signal?.aborted) throw new Error("Carga cancelada.")
  await folder.saveImage(id, file)
  onProgress?.({ progress: 100 })
  return `${SYNTHESIS_LOCAL_IMAGE_PREFIX}${id}`
}

export async function migrateSynthesisImagesToFolder(folder: SynthesisFolderStore) {
  const db = await openDatabase()
  try {
    const keys = await new Promise<IDBValidKey[]>((resolve, reject) => {
      const request = db.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).getAllKeys()
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    for (const key of keys) {
      const blob = await new Promise<Blob>((resolve, reject) => {
        const request = db.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).get(key)
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
      })
      if (blob instanceof Blob && !(await folder.readImage(String(key)))) await folder.saveImage(String(key), blob)
    }
  } finally { db.close() }
}

export async function loadSynthesisImage(id: string): Promise<Blob | null> {
  const folder = await getSynthesisFolderStore()
  const value = await folder.readImage(id)
  if (value) return value
  const response = await fetch("/api/inscreen/synthesis-images?id=" + encodeURIComponent(id), { cache: "no-store" })
  if (!response.ok) throw new Error("No se pudo recuperar la imagen desde R2.")
  const remote = await response.blob()
  await folder.saveImage(id, remote)
  return remote
}

export async function deleteSynthesisImage(id: string): Promise<void> {
  // Archived documents may still reference this file; retain its local original.
  void id
}

export function localImageId(src: unknown) {
  return typeof src === "string" && src.startsWith(SYNTHESIS_LOCAL_IMAGE_PREFIX)
    ? src.slice(SYNTHESIS_LOCAL_IMAGE_PREFIX.length)
    : null
}
