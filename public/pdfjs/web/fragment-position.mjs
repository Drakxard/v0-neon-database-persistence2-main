// Coordinates from Datalab describe the visible (rotated) page, with a top-left origin.
export async function scrollToFragmentRegion(app, serialized) {
  let region
  try { region = JSON.parse(serialized) } catch { return false }
  if (!region || !Number.isInteger(region.page) || region.page < 1 || region.page > app.pdfDocument.numPages ||
      ![region.x1, region.y1, region.x2, region.y2].every(value => Number.isFinite(value) && value >= 0 && value <= 1) ||
      region.x2 <= region.x1 || region.y2 <= region.y1) return false
  const initialized = app.eventBus && !app.isInitialViewSet
    ? new Promise(resolve => app.eventBus._on("documentinit", resolve, { once: true })) : Promise.resolve()
  await Promise.all([app.pdfViewer.pagesPromise, initialized])
  // Initial view restoration and mixed page-size layout can also scroll: finish them first.
  if (typeof requestAnimationFrame === "function") await new Promise(resolve => requestAnimationFrame(resolve))
  const page = await app.pdfDocument.getPage(region.page)
  const viewport = page.getViewport({ scale: 1 })
  const [x, y] = viewport.convertToPdfPoint(region.x1 * viewport.width, Math.max(0, region.y1 - 0.025) * viewport.height)
  app.pdfViewer.scrollPageIntoView({ pageNumber: region.page,
    destArray: [null, { name: "XYZ" }, x, y, null], allowNegativeOffset: false })
  return true
}
