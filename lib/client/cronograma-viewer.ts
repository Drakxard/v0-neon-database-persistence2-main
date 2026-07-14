export function buildCronogramaViewerHref(fileName: string, workspaceFileId?: string | null) {
  const isLocalWorkspaceFile = Boolean(workspaceFileId?.startsWith("workspace://"))
  const searchParams = new URLSearchParams({
    resourceType: "cronograma",
    file: isLocalWorkspaceFile ? "" : "/api/cronograma/file",
    fileName,
    key: "cronograma-current",
  })

  if (isLocalWorkspaceFile && workspaceFileId) {
    searchParams.set("localWorkspace", "1")
    searchParams.set("workspaceFileId", workspaceFileId)
  }

  return `/pdfjs/web/viewer.html?${searchParams.toString()}#locale=es-AR`
}

export function openCronogramaViewer(fileName: string, workspaceFileId?: string | null) {
  window.open(buildCronogramaViewerHref(fileName, workspaceFileId), "_blank", "noopener,noreferrer")
}
