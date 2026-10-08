"use client"

import { getWorkspaceFile } from "../local-workspace-data"
import { normalizedPdfRegion, parsePdfExtraction, PDF_EXTRACTION_VERSION, PDF_FILTER_VERSION, type PdfRegion, type PdfSearchResult, type PdfWordUnit } from "../subject-pdf-search"
import { inPdfCacheQueue, pdfWorkspaceRoot, readPdfCache, writePdfCache, readPdfCrop, writePdfCrop } from "./subject-pdf-cache"
import { pdfHash } from "./subject-pdf-files"
import { refinedPageWords } from "./subject-pdf-search"
import { pdfRegionId, readPdfCorrection } from "./subject-pdf-corrections"

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
  // Word add-ons can be present only in the top-level HTML, rather than JSON block HTML.
  const source = extraction.blocks.some((block) => block.region && intersects(block.region, target) && /data-bbox=/.test(block.html)) ? extraction.blocks
    : typeof payload.html === "string" && extraction.blocks[0]
      ? [{ ...extraction.blocks[0], region: target, html: payload.html }] : extraction.blocks
  for (const block of source) {
    if (!block.region || !intersects(block.region, target)) continue
    const document = new DOMParser().parseFromString(block.html, "text/html")
    const spans = [...document.querySelectorAll("span[data-bbox]")]
    if (!spans.length) continue
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
  const path = `manifests/subject-voice/pdf/${PDF_EXTRACTION_VERSION}/${result.hash}/${PDF_FILTER_VERSION}/regions-html-v2-${key}.json`
  return inPdfCacheQueue(root, path, async () => {
    const saved = await readPdfCache<{ regions: PdfRegion[]; warnings: string[] }>(root, path)
    if (saved) return saved
    const regions: PdfRegion[] = [], warnings: string[] = []
    let failed = false
    for (const block of result.candidate.blocks) {
      signal.throwIfAborted()
      if (result.decision.blockIds.includes(block.id)) {
        if (block.region) regions.push(block.region)
        else warnings.push("Un bloque relevante no tiene coordenadas fiables y no pudo recortarse.")
      } else if (result.decision.partialIds.includes(block.id)) {
        if (!block.region) { warnings.push("No se pudo delimitar un bloque mixto sin coordenadas."); continue }
        try {
          const payload = await refinedPageWords(result, block.page, signal, progress)
          const units = wordUnits(payload, block.region)
          if (!units.length) { failed = true; warnings.push("Datalab no devolvió palabras con coordenadas fiables para un bloque mixto; podés comprobarlo en el PDF original."); continue }
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
        } catch (error) {
          signal.throwIfAborted()
          failed = true
          warnings.push(error instanceof Error ? error.message : "No se pudo delimitar un bloque mixto.")
        }
      }
    }
    const savedRegions = { regions, warnings }
    if (!failed) await writePdfCache(root, path, savedRegions)
    return savedRegions
  })
}

export async function renderPdfFragment(result: PdfSearchResult, signal: AbortSignal, progress: (text: string) => void) {
  const file = await getWorkspaceFile(result.fileId)
  if (await pdfHash(file) !== result.hash) throw new Error("El PDF cambió. Volvé a buscar para usar su nueva versión.")
  const { regions, warnings } = await resolveRegions(result, signal, progress)
  const correction = await readPdfCorrection(result)
  signal.throwIfAborted()
  const root = await pdfWorkspaceRoot()
  let document: Awaited<ReturnType<typeof import("pdfjs-dist/build/pdf.mjs").getDocument>["promise"]> | null = null
  const images: Array<{ page: number; url: string; region: PdfRegion; id: string }> = []
  const canvas = window.document.createElement("canvas")
  let context: CanvasRenderingContext2D | null = null
  let renderedPage = -1
  try {
    for (const region of regions) {
      const id = pdfRegionId(region)
      if (correction.removedRegions.includes(id)) continue
      signal.throwIfAborted()
      const cropKey = await pdfHash(new File([id], "crop.txt"))
      const cropPath = `manifests/subject-voice/pdf/${PDF_EXTRACTION_VERSION}/${result.hash}/crops-png-v1/${cropKey}.png`
      const savedCrop = await readPdfCrop(root, cropPath)
      signal.throwIfAborted()
      if (savedCrop && savedCrop.size) {
        images.push({page:region.page,url:URL.createObjectURL(savedCrop),region,id})
        continue
      }
      if (!document) {
        context = canvas.getContext("2d")
        const pdfjs = await import("pdfjs-dist/build/pdf.mjs")
        pdfjs.GlobalWorkerOptions.workerSrc = "/pdfjs/build/pdf.worker.min.mjs"
        document = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise
      }
      if (!context) throw new Error("El navegador no pudo dibujar el fragmento.")
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
      await writePdfCrop(root, cropPath, blob)
      images.push({ page: region.page, url: URL.createObjectURL(blob), region, id })
    }
    return { images, warnings }
  } catch (error) { images.forEach((image) => URL.revokeObjectURL(image.url)); throw error }
  finally { canvas.width = canvas.height = 1; await document?.destroy() }
}
