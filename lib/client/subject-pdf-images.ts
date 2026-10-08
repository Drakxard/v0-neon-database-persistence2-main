"use client"

import { PdfSourceError, relatedPdfPages } from "./subject-pdf-pages"
import type { PdfSearchResult } from "../subject-pdf-search"

type PageImage = { blob: Blob; width: number; height: number; page: number }
const renderedPages = new Map<string, Omit<PageImage, "blob"> & { blob: WeakRef<Blob> }>()
const imageUrls = new WeakMap<Blob, { url: string; users: number }>()

export function retainPdfImageUrl(blob: Blob) {
  let entry = imageUrls.get(blob)
  if (!entry) { entry = { url: URL.createObjectURL(blob), users: 0 }; imageUrls.set(blob, entry) }
  entry.users++
  let released = false
  return { url: entry.url, release: () => {
    if (released) return
    released = true
    if (--entry.users === 0) { URL.revokeObjectURL(entry.url); imageUrls.delete(blob) }
  } }
}

// Render pages once, then release PDF.js and its decoded document. Only image
// blobs remain mounted while the current results are available.
export async function renderRelatedPdfImages(file: File, result: PdfSearchResult, signal: AbortSignal) {
  const pages = relatedPdfPages(result)
  const width = Math.min(2400, Math.max(1200, window.innerWidth * Math.min(window.devicePixelRatio, 1.5)))
  const keyFor = (page: number) => `${result.hash}:${width}:${page}`
  const cached = (page: number): PageImage | null => {
    const saved = renderedPages.get(keyFor(page)), blob = saved?.blob.deref()
    return saved && blob ? { ...saved, blob } : null
  }
  signal.throwIfAborted()
  const ready = pages.map(cached)
  if (pages.length && ready.every((image): image is PageImage => image !== null)) return ready
  const pdfjs = await import("pdfjs-dist/build/pdf.mjs")
  pdfjs.GlobalWorkerOptions.workerSrc = "/pdfjs/build/pdf.worker.min.mjs"
  signal.throwIfAborted()
  const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) })
  const abort = () => { void task.destroy() }
  signal.addEventListener("abort", abort, { once: true })
  try {
    const document = await task.promise
    if (!pages.length || pages.some(page => page > document.numPages)) throw new PdfSourceError("invalid", "Las páginas del resultado no corresponden al PDF. Volvé a buscar.")
    const images: PageImage[] = []
    for (const number of pages) {
      signal.throwIfAborted()
      const saved = cached(number)
      if (saved) { images.push(saved); continue }
      const page = await document.getPage(number)
      const base = page.getViewport({ scale: 1 })
      // Bound raster size even on very large screens or unusually sized pages.
      const viewport = page.getViewport({ scale: width / base.width })
      const canvas = documentCanvas(viewport.width, viewport.height)
      await page.render({ canvas, canvasContext: canvas.getContext("2d")!, viewport }).promise
      const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error("No se pudo preparar la imagen del PDF.")), "image/webp", 0.94))
      const image = { blob, width: canvas.width, height: canvas.height, page: number }
      images.push(image)
      renderedPages.set(keyFor(number), { ...image, blob: new WeakRef(blob) })
      // Weak references share pages between results without retaining blobs
      // after their views have released them. Bound the metadata as well.
      if (renderedPages.size > 128) renderedPages.delete(renderedPages.keys().next().value!)
      canvas.width = canvas.height = 0
      page.cleanup()
    }
    signal.throwIfAborted()
    return images
  } catch (error) {
    if (signal.aborted || error instanceof PdfSourceError) throw error
    throw new PdfSourceError("invalid", "No se pudo leer el PDF. Comprobá que sea válido y no esté protegido.")
  } finally {
    signal.removeEventListener("abort", abort)
    await task.destroy()
  }
}

function documentCanvas(width: number, height: number) {
  const canvas = document.createElement("canvas")
  canvas.width = Math.ceil(width); canvas.height = Math.ceil(height)
  return canvas
}
