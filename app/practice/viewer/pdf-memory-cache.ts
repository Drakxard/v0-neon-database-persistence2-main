"use client"

export type CachedPracticePdf = {
  blobUrl: string
  contentType: string
  fileName: string
  materialId: number
  size: number
}

type CacheEntry = {
  promise: Promise<CachedPracticePdf>
  value?: CachedPracticePdf
}

const pdfCache = new Map<number, CacheEntry>()

function buildPracticePdfUrl(materialId: number) {
  return `/api/subject-day-materials/${materialId}/file`
}

function extractErrorMessage(payload: unknown, fallback: string) {
  if (payload && typeof payload === "object" && "error" in payload && typeof payload.error === "string") {
    return payload.error
  }

  return fallback
}

async function fetchPracticePdf(materialId: number, fileName: string) {
  const response = await fetch(buildPracticePdfUrl(materialId), {
    credentials: "same-origin",
  })

  if (!response.ok) {
    let message = "No se pudo descargar el PDF."

    try {
      const payload = await response.json()
      message = extractErrorMessage(payload, message)
    } catch {}

    throw new Error(message)
  }

  const blob = await response.blob()
  const safeBlob = blob.type ? blob : new Blob([blob], { type: "application/pdf" })

  return {
    blobUrl: URL.createObjectURL(safeBlob),
    contentType: safeBlob.type || "application/pdf",
    fileName,
    materialId,
    size: safeBlob.size,
  } satisfies CachedPracticePdf
}

export function preloadPracticePdf(materialId: number, fileName: string) {
  const existing = pdfCache.get(materialId)
  if (existing) {
    return existing.promise
  }

  const promise = fetchPracticePdf(materialId, fileName)
    .then((value) => {
      const current = pdfCache.get(materialId)
      if (current) {
        current.value = value
      }
      return value
    })
    .catch((error) => {
      pdfCache.delete(materialId)
      throw error
    })

  pdfCache.set(materialId, { promise })
  return promise
}

export function releasePracticePdf(materialId: number) {
  const existing = pdfCache.get(materialId)
  if (!existing?.value) return

  URL.revokeObjectURL(existing.value.blobUrl)
  pdfCache.delete(materialId)
}
