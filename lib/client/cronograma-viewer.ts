"use client"

import { getLocalCronograma, getWorkspaceCronogramaObjectUrl } from "@/lib/local-workspace-data"
import { isLocalStorageMode } from "@/lib/storage-mode"

export function buildCronogramaViewerHref(fileName: string) {
  if (isLocalStorageMode()) {
    return "#"
  }

  const searchParams = new URLSearchParams({
    resourceType: "cronograma",
    file: "/api/cronograma/file",
    fileName,
    key: "cronograma-current",
  })

  return `/pdfjs/web/viewer.html?${searchParams.toString()}#locale=es-AR`
}

export async function openCronogramaViewer(fileName: string) {
  if (isLocalStorageMode()) {
    const cronograma = await getLocalCronograma()
    const fileUrl = await getWorkspaceCronogramaObjectUrl()
    if (!fileUrl) {
      throw new Error("No se encontro el cronograma local.")
    }

    const searchParams = new URLSearchParams({
      resourceType: "cronograma",
      file: fileUrl,
      fileName,
      key: `cronograma-local-${Date.now()}`,
      localWorkspace: "1",
    })
    if (cronograma?.driveFileId) {
      searchParams.set("workspaceFileId", cronograma.driveFileId)
    }
    window.location.assign(`/pdfjs/web/viewer.html?${searchParams.toString()}#locale=es-AR`)
    return
  }

  window.location.assign(buildCronogramaViewerHref(fileName))
}
