import { SYNTHESIS_LOCAL_IMAGE_PREFIX, SYNTHESIS_MAX_IMAGE_BYTES } from "@/lib/synthesis-workspace"

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
  const db = await openDatabase()
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readwrite")
    transaction.objectStore(STORE_NAME).put(file, id)
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error ?? new Error("No se pudo guardar la imagen."))
    transaction.onabort = () => reject(transaction.error ?? new Error("Se canceló el guardado de la imagen."))
    signal?.addEventListener("abort", () => transaction.abort(), { once: true })
  })
  db.close()
  onProgress?.({ progress: 100 })
  return `${SYNTHESIS_LOCAL_IMAGE_PREFIX}${id}`
}

export async function loadSynthesisImage(id: string): Promise<Blob | null> {
  const db = await openDatabase()
  const value = await new Promise<Blob | null>((resolve, reject) => {
    const request = db.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).get(id)
    request.onsuccess = () => resolve(request.result instanceof Blob ? request.result : null)
    request.onerror = () => reject(request.error)
  })
  db.close()
  return value
}

export async function deleteSynthesisImage(id: string): Promise<void> {
  const db = await openDatabase()
  await new Promise<void>((resolve, reject) => {
    const request = db.transaction(STORE_NAME, "readwrite").objectStore(STORE_NAME).delete(id)
    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error)
  })
  db.close()
}

export function localImageId(src: unknown) {
  return typeof src === "string" && src.startsWith(SYNTHESIS_LOCAL_IMAGE_PREFIX)
    ? src.slice(SYNTHESIS_LOCAL_IMAGE_PREFIX.length)
    : null
}
