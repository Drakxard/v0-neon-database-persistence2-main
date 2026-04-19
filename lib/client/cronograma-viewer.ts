"use client"

import { loadCronogramaPdf, saveCronogramaPdf, type StoredCronogramaPdf } from "@/lib/client/cronograma-pdf"

export function buildCronogramaViewerHref(blobUrl: string, fileName: string) {
  const searchParams = new URLSearchParams({
    url: blobUrl,
    name: fileName,
    key: "cronograma-local",
  })

  return `/visor/index.html?${searchParams.toString()}`
}

function openViewerForStoredPdf(storedPdf: StoredCronogramaPdf) {
  const blobUrl = URL.createObjectURL(storedPdf.file)
  window.open(buildCronogramaViewerHref(blobUrl, storedPdf.name), "_blank", "noopener,noreferrer")
}

export async function openStoredCronogramaPdf() {
  const storedPdf = await loadCronogramaPdf()
  if (!storedPdf) return false

  openViewerForStoredPdf(storedPdf)
  return true
}

export async function saveAndOpenCronogramaPdf(file: File) {
  await saveCronogramaPdf(file)
  openViewerForStoredPdf({
    name: file.name,
    type: file.type || "application/pdf",
    file,
    updatedAt: Date.now(),
  })
}
