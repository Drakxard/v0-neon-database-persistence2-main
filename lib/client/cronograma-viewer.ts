export function buildCronogramaViewerHref(fileName: string) {
  const searchParams = new URLSearchParams({
    resourceType: "cronograma",
    file: "/api/cronograma/file",
    fileName,
    key: "cronograma-current",
  })

  return `/pdfjs/web/viewer.html?${searchParams.toString()}#locale=es-AR`
}

export function openCronogramaViewer(fileName: string) {
  window.open(buildCronogramaViewerHref(fileName), "_blank", "noopener,noreferrer")
}
