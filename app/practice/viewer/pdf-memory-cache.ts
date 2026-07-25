"use client"

export type CachedPracticePdf = {
  blobUrl: string
  cacheKey: string
  contentType: string
  fileName: string
  materialId: number
  size: number
}

type CacheEntry = {
  promise: Promise<CachedPracticePdf>
  value?: CachedPracticePdf
}

const pdfCache = new Map<string, CacheEntry>()

export function buildPracticePdfCacheKey(materialId: number, sourceRevision = "") {
  return `${materialId}:${sourceRevision || "current"}`
}

function buildPracticePdfUrl(materialId: number, sourceRevision: string) {
  const params = new URLSearchParams()
  if (sourceRevision) params.set("revision", sourceRevision)
  const query = params.toString()
  return `/api/subject-day-materials/${materialId}/file${query ? `?${query}` : ""}`
}

function extractErrorMessage(payload: unknown, fallback: string) {
  if (payload && typeof payload === "object" && "error" in payload && typeof payload.error === "string") {
    return payload.error
  }

  return fallback
}

async function fetchPracticePdf(materialId: number, fileName: string, sourceRevision: string) {
  const cacheKey = buildPracticePdfCacheKey(materialId, sourceRevision)
  const response = await fetch(buildPracticePdfUrl(materialId, sourceRevision), {
    cache: "no-store",
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

  const responseMaterialId = Number.parseInt(response.headers.get("X-Material-Id") || "", 10)
  if (Number.isInteger(responseMaterialId) && responseMaterialId !== materialId) {
    throw new Error(`La descarga devolvió el material ${responseMaterialId}, pero se esperaba ${materialId}.`)
  }

  const blob = await response.blob()
  const safeBlob = blob.type ? blob : new Blob([blob], { type: "application/pdf" })
  const header = await safeBlob.slice(0, 1024).text()
  if (!header.includes("%PDF-")) {
    throw new Error(`El archivo recibido para el material ${materialId} no contiene una cabecera PDF válida.`)
  }

  return {
    blobUrl: URL.createObjectURL(safeBlob),
    cacheKey,
    contentType: safeBlob.type || "application/pdf",
    fileName,
    materialId,
    size: safeBlob.size,
  } satisfies CachedPracticePdf
}

export function preloadPracticePdf(materialId: number, fileName: string, sourceRevision = "") {
  const cacheKey = buildPracticePdfCacheKey(materialId, sourceRevision)
  const existing = pdfCache.get(cacheKey)
  if (existing) {
    return existing.promise
  }

  const promise = fetchPracticePdf(materialId, fileName, sourceRevision)
    .then((value) => {
      const current = pdfCache.get(cacheKey)
      if (current) {
        current.value = value
      }
      return value
    })
    .catch((error) => {
      pdfCache.delete(cacheKey)
      throw error
    })

  pdfCache.set(cacheKey, { promise })
  return promise
}

export function releasePracticePdf(cacheKey: string) {
  const existing = pdfCache.get(cacheKey)
  if (!existing?.value) return

  URL.revokeObjectURL(existing.value.blobUrl)
  pdfCache.delete(cacheKey)
}
