"use client"

const DB_NAME = "study-pdfs"
const STORE_NAME = "local-pdfs"
const CRONOGRAMA_KEY = "cronograma"

type StoredCronogramaPdfRecord = {
  key: string
  name: string
  type: string
  bytes: ArrayBuffer
  updatedAt: number
}

export type StoredCronogramaPdf = {
  name: string
  type: string
  file: File
  updatedAt: number
}

function openDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof window === "undefined" || typeof indexedDB === "undefined") {
      reject(new Error("Este navegador no soporta IndexedDB."))
      return
    }

    const request = indexedDB.open(DB_NAME, 1)

    request.onerror = () => {
      reject(request.error ?? new Error("No se pudo abrir la base local."))
    }

    request.onupgradeneeded = () => {
      const database = request.result
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME, { keyPath: "key" })
      }
    }

    request.onsuccess = () => {
      resolve(request.result)
    }
  })
}

export async function saveCronogramaPdf(file: File) {
  const database = await openDatabase()

  try {
    const bytes = await file.arrayBuffer()

    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, "readwrite")
      const store = transaction.objectStore(STORE_NAME)
      const record: StoredCronogramaPdfRecord = {
        key: CRONOGRAMA_KEY,
        name: file.name,
        type: file.type || "application/pdf",
        bytes,
        updatedAt: Date.now(),
      }

      const request = store.put(record)
      request.onerror = () => reject(request.error ?? new Error("No se pudo guardar el cronograma."))
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error ?? new Error("No se pudo guardar el cronograma."))
    })
  } finally {
    database.close()
  }
}

export async function loadCronogramaPdf(): Promise<StoredCronogramaPdf | null> {
  const database = await openDatabase()

  try {
    const record = await new Promise<StoredCronogramaPdfRecord | null>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, "readonly")
      const store = transaction.objectStore(STORE_NAME)
      const request = store.get(CRONOGRAMA_KEY)

      request.onsuccess = () => resolve((request.result as StoredCronogramaPdfRecord | undefined) ?? null)
      request.onerror = () => reject(request.error ?? new Error("No se pudo leer el cronograma guardado."))
    })

    if (!record) return null

    return {
      name: record.name,
      type: record.type || "application/pdf",
      file: new File([record.bytes], record.name, {
        type: record.type || "application/pdf",
        lastModified: record.updatedAt,
      }),
      updatedAt: record.updatedAt,
    }
  } finally {
    database.close()
  }
}
