"use client"

import { getWorkspaceFile } from "../local-workspace-data"
import { normalizedPdfRegion, parsePdfExtraction, PDF_EXTRACTION_VERSION, PDF_FILTER_VERSION, type PdfRegion, type PdfSearchResult, type PdfWordUnit } from "../subject-pdf-search"
import { inPdfCacheQueue, pdfWorkspaceRoot, readPdfCache, writePdfCache } from "./subject-pdf-cache"
import { pdfHash } from "./subject-pdf-files"
import { refinedPageWords } from "./subject-pdf-search"

function intersects(a: PdfRegion, b: PdfRegion) {
  return a.page === b.page && Math.max(a.x1, b.x1) < Math.min(a.x2, b.x2) && Math.max(a.y1, b.y1) < Math.min(a.y2, b.y2)
}
function wordUnits(payload: Record<string, unknown>, target: PdfRegion): PdfWordUnit[] {
  const extraction = parsePdfExtraction(payload, [target.page])
  const units: PdfWordUnit[] = []
  let text: string[] = [], regions: PdfRegion[] = []
  const flush = () => {
    if (text.length) units.push({ id: `u${units.length}`, text: text.join(" "), regions })
    text = []; regions = []
  }
  for (const block of extraction.blocks) {
    if (!block.region || !intersects(block.region, target)) continue
    const document = new DOMParser().parseFromString(block.html, "text/html")
    const spans = [...document.querySelectorAll("span[data-bbox]")]
    if (!spans.length) throw new Error("Datalab no devolvió coordenadas por palabra para el bloque mixto.")
    let parent: Element | null = null
    for (const span of spans) {
      const coords = (span.getAttribute("data-bbox") ?? "").split(/[\s,]+/).filter(Boolean).map(Number)
      const word = span.textContent?.trim() ?? ""
      const region = coords.length === 4 ? normalizedPdfRegion(coords, [0, 0, block.width, block.height], target.page) : null
      if (!word) continue
      if (!region) throw new Error("Las coordenadas por palabra no corresponden a la página original.")
      const cx = (region.x1 + region.x2) / 2, cy = (region.y1 + region.y2) / 2
      if (cx < target.x1 || cx > target.x2 || cy < target.y1 || cy > target.y2) continue
      const nextParent = span.closest("p,li,h1,h2,h3,h4,h5,h6")
      if (parent !== nextParent) flush()
      parent = nextParent
      text.push(word); regions.push(region)
      // Units follow source sentences/paragraphs; numeric identifiers are not split internally.
      if (/[.!?;:]$/.test(word)) flush()
    }
    flush()
  }
  return units
}
function lineRegions(regions: PdfRegion[]) {
  const lines: PdfRegion[] = []
  for (const region of regions) {
    const last = lines.at(-1)
    const yOverlap = last ? Math.min(last.y2, region.y2) - Math.max(last.y1, region.y1) : 0
    if (last && last.page === region.page && yOverlap > Math.min(last.y2 - last.y1, region.y2 - region.y1) * 0.5 && region.x1 - last.x2 < 0.04 && region.x1 >= last.x1) {
      last.x2 = Math.max(last.x2, region.x2); last.y1 = Math.min(last.y1, region.y1); last.y2 = Math.max(last.y2, region.y2)
    } else lines.push({ ...region })
  }
  return lines
}
async function resolveRegions(result: PdfSearchResult, signal: AbortSignal, progress: (text: string) => void) {
  const root = await pdfWorkspaceRoot()
  const key = await pdfHash(new File([JSON.stringify([result.query, result.candidate, result.decision])], "region.txt"))
  const path = `manifests/subject-voice/pdf/${PDF_EXTRACTION_VERSION}/${result.hash}/${PDF_FILTER_VERSION}/regions-${key}.json`
  return inPdfCacheQueue(root, path, async () => {
    const saved = await readPdfCache<{ regions: PdfRegion[]; warnings: string[] }>(root, path)
    if (saved) return saved
    const regions: PdfRegion[] = [], warnings: string[] = []
    for (const block of result.candidate.blocks) {
      signal.throwIfAborted()
      if (result.decision.blockIds.includes(block.id)) {
        if (block.region) regions.push(block.region)
        else warnings.push("Un bloque relevante no tiene coordenadas fiables y no pudo recortarse.")
      } else if (result.decision.partialIds.includes(block.id)) {
        if (!block.region) { warnings.push("No se pudo delimitar un bloque mixto sin coordenadas."); continue }
        const payload = await refinedPageWords(result, block.page, signal, progress)
        const units = wordUnits(payload, block.region)
        if (!units.length) { warnings.push("No se encontraron palabras con coordenadas fiables en el bloque mixto."); continue }
        let uncertain = false, included = 0
        const selected: PdfRegion[] = []
        for (let i = 0; i < units.length; i += 64) {
          signal.throwIfAborted()
          const group = units.slice(i, i + 64)
          const response = await fetch("/api/subject-voice/pdf-refine", { method: "POST", headers: { "Content-Type": "application/json" },
            signal: AbortSignal.timeout(55_000),
            body: JSON.stringify({ query: result.query, context: result.candidate.blocks.map((b) => b.text).join("\n"), units: group }) })
          const decision = await response.json() as { ids?: string[]; uncertain?: boolean; error?: string }
          if (!response.ok) throw new Error(decision.error ?? "No se pudo delimitar con Clef.")
          if (!Array.isArray(decision.ids) || decision.ids.some((id) => !group.some((u) => u.id === id)) || typeof decision.uncertain !== "boolean") throw new Error("Clef devolvió unidades desconocidas.")
          uncertain ||= decision.uncertain
          for (const unit of group) if (decision.ids.includes(unit.id)) { included++; selected.push(...unit.regions) }
        }
        // If every unit was included, the contradiction with 'partial' remains unresolved.
        if (uncertain || included === units.length || !included) warnings.push("No se pudo separar con fiabilidad el contenido pertinente de un bloque mixto; ese bloque no se muestra.")
        else regions.push(...lineRegions(selected))
      }
    }
    const savedRegions = { regions, warnings }
    await writePdfCache(root, path, savedRegions)
    return savedRegions
  })
}

export async function renderPdfFragment(result: PdfSearchResult, signal: AbortSignal, progress: (text: string) => void) {
  const file = await getWorkspaceFile(result.fileId)
  if (await pdfHash(file) !== result.hash) throw new Error("El PDF cambió. Volvé a buscar para usar su nueva versión.")
  const { regions, warnings } = await resolveRegions(result, signal, progress)
  signal.throwIfAborted()
  const pdfjs = await import("pdfjs-dist/build/pdf.mjs")
  pdfjs.GlobalWorkerOptions.workerSrc = "/pdfjs/build/pdf.worker.min.mjs"
  const document = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise
  const images: Array<{ page: number; url: string }> = []
  const canvas = window.document.createElement("canvas"), context = canvas.getContext("2d")
  let renderedPage = -1
  try {
    if (!context) throw new Error("El navegador no pudo dibujar el fragmento.")
    for (const region of regions) {
      signal.throwIfAborted()
      if (renderedPage !== region.page) {
        const page = await document.getPage(region.page)
        // PDF.js applies intrinsic rotation; provider boxes describe the visible page.
        const initial = page.getViewport({ scale: 1 })
        const scale = Math.min(2, 4096 / Math.max(initial.width, initial.height))
        const viewport = page.getViewport({ scale })
        canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height)
        await page.render({ canvas, canvasContext: context, viewport }).promise
        renderedPage = region.page
      }
      const padding = 3
      const x = Math.max(0, Math.floor(region.x1 * canvas.width) - padding), y = Math.max(0, Math.floor(region.y1 * canvas.height) - padding)
      const right = Math.min(canvas.width, Math.ceil(region.x2 * canvas.width) + padding), bottom = Math.min(canvas.height, Math.ceil(region.y2 * canvas.height) + padding)
      const crop = window.document.createElement("canvas")
      crop.width = right - x; crop.height = bottom - y
      const cropContext = crop.getContext("2d")
      if (!cropContext || crop.width < 1 || crop.height < 1) throw new Error("La región del fragmento es inválida.")
      cropContext.drawImage(canvas, x, y, crop.width, crop.height, 0, 0, crop.width, crop.height)
      const blob = await new Promise<Blob>((resolve, reject) => crop.toBlob((blob) => blob ? resolve(blob) : reject(new Error("No se pudo crear el recorte.")), "image/png"))
      crop.width = crop.height = 1
      images.push({ page: region.page, url: URL.createObjectURL(blob) })
    }
    return { images, warnings }
  } catch (error) { images.forEach((image) => URL.revokeObjectURL(image.url)); throw error }
  finally { canvas.width = canvas.height = 1; await document.destroy() }
}
