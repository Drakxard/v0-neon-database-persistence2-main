// Shared, deterministic document/search logic. No provider credentials or browser state.
export const PDF_EXTRACTION_VERSION = "datalab-balanced-json-v1"
export const PDF_FILTER_VERSION = "clef-fragments-v1"
export const PDF_BATCH_BYTES = 3 * 1024 * 1024
export const PDF_BATCH_PAGES = 10

export type PdfRegion = { page: number; rotation: number; x1: number; y1: number; x2: number; y2: number }
export type PdfBlock = {
  id: string; page: number; order: number; type: string; text: string; html: string
  width: number; height: number; bbox: number[] | null; region: PdfRegion | null
}
export type PdfExtraction = { blocks: PdfBlock[]; raw: unknown; markdown: string; failedPages: number[] }
export type PdfCandidate = { id: string; title: string; anchorIds: string[]; blocks: PdfBlock[] }
export type PdfDecision = { id: string; accepted: boolean; blockIds: string[]; partialIds: string[] }
export type PdfWordUnit = { id: string; text: string; regions: PdfRegion[] }
export type PdfSearchResult = {
  id: string; title: string; fileName: string; fileId: string; hash: string; week: number
  query: string; candidate: PdfCandidate; decision: PdfDecision
}

export function normalizePdfQuery(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .match(/[\p{L}\p{N}]+(?:\.[\p{N}]+)*/gu)?.map((word) => word === "teo" ? "teorema" : word).join(" ") ?? ""
}
function variants(word: string) {
  return [word, ...(word.length > 3 && word.endsWith("s") ? [word.slice(0, -1)] : []),
    ...(word.length > 4 && word.endsWith("es") ? [word.slice(0, -2)] : [])]
}
export function pdfTextMatches(text: string, query: string) {
  const terms = normalizePdfQuery(query).split(" ").filter(Boolean)
  const tokens = normalizePdfQuery(text).split(" ").flatMap(variants)
  return terms.length > 0 && terms.every((term) => variants(term).some((form) => tokens.includes(form)))
}

export function htmlToPdfText(html: string) {
  return html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<\/?(?:p|div|h[1-6]|br|li|tr)\b[^>]*>/gi, " ").replace(/<[^>]+>/g, "")
    .replace(/&#(x[0-9a-f]+|\d+);/gi, (_, code: string) => {
      const n = code[0].toLowerCase() === "x" ? parseInt(code.slice(1), 16) : Number(code)
      return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : " "
    }).replace(/&(nbsp|amp|lt|gt|quot|apos);/g, (_, entity: string) => ({
      nbsp: " ", amp: "&", lt: "<", gt: ">", quot: '"', apos: "'",
    })[entity] ?? " ").replace(/\s+/g, " ").trim()
}
function box(value: unknown): number[] | null {
  if (Array.isArray(value) && value.length === 4 && value.every((v) => typeof v === "number" && Number.isFinite(v))) return value
  if (Array.isArray(value) && value.length >= 4 && value.every((v) => Array.isArray(v) && v.length === 2 && v.every(Number.isFinite))) {
    return [Math.min(...value.map((p) => p[0])), Math.min(...value.map((p) => p[1])),
      Math.max(...value.map((p) => p[0])), Math.max(...value.map((p) => p[1]))]
  }
  return null
}
export function normalizedPdfRegion(bbox: number[] | null, pageBox: number[] | null, page: number): PdfRegion | null {
  if (!bbox || !pageBox) return null
  const [px, py, pr, pb] = pageBox, [x1, y1, x2, y2] = bbox
  if (pr <= px || pb <= py || x2 <= x1 || y2 <= y1 || x1 < px || y1 < py || x2 > pr || y2 > pb) return null
  return { page, rotation: 0, x1: (x1 - px) / (pr - px), y1: (y1 - py) / (pb - py),
    x2: (x2 - px) / (pr - px), y2: (y2 - py) / (pb - py) }
}
export function parsePdfExtraction(payload: Record<string, unknown>, originalPages: number[]): PdfExtraction {
  const blocks: PdfBlock[] = []
  const seenPages = new Set<number>()
  let pageIndex = -1
  const walk = (value: unknown, page = 0, pageBox: number[] | null = null) => {
    if (Array.isArray(value)) { value.forEach((v) => walk(v, page, pageBox)); return }
    if (!value || typeof value !== "object") return
    const node = value as Record<string, unknown>
    const type = String(node.block_type ?? node.type ?? "")
    const bbox = box(node.bbox) ?? box(node.polygon)
    if (type === "Page") {
      pageIndex++
      // Marker page IDs are zero-based within the submitted batch.
      const idPage = /\/page\/(\d+)(?:\/|$)/.exec(String(node.id ?? ""))
      const index = idPage ? Number(idPage[1]) : pageIndex
      page = originalPages[index] ?? 0
      if (page) seenPages.add(page)
      pageBox = bbox
      if (!pageBox && Number(node.width) > 0 && Number(node.height) > 0) pageBox = [0, 0, Number(node.width), Number(node.height)]
    }
    if (Array.isArray(node.children) && node.children.length) { node.children.forEach((v) => walk(v, page, pageBox)); return }
    const html = String(node.html ?? "")
    const text = htmlToPdfText(html) || String(node.text ?? node.markdown ?? "").trim()
    if (!page || !text || ["PageHeader", "PageFooter"].includes(type)) return
    const rawId = String(node.id ?? blocks.length)
    blocks.push({ id: `${page}:${rawId}`, page, order: blocks.length, type, text, html,
      width: pageBox ? pageBox[2] - pageBox[0] : 0, height: pageBox ? pageBox[3] - pageBox[1] : 0,
      bbox, region: normalizedPdfRegion(bbox, pageBox, page) })
  }
  walk(payload.json)
  if (!blocks.length) throw new Error("Datalab no devolvió bloques de texto con páginas reconocibles.")
  const metadata = payload.metadata as { failed_pages?: unknown } | undefined
  const reportedFailures = Array.isArray(metadata?.failed_pages) ? metadata.failed_pages.map((n) => originalPages[Number(n)]).filter((n): n is number => Boolean(n)) : []
  const failedPages = [...new Set([...reportedFailures, ...originalPages.filter((page) => !seenPages.has(page))])]
  return { blocks, raw: payload.json, markdown: String(payload.markdown ?? ""), failedPages }
}

function heading(block: PdfBlock) { return block.type === "SectionHeader" || /<h[1-6]\b/i.test(block.html) }
export function buildPdfCandidates(blocks: PdfBlock[], query: string): PdfCandidate[] {
  const groups = new Map<number, { start: number; end: number; anchors: string[] }>()
  const terms = normalizePdfQuery(query).split(" ").filter(Boolean)
  if (!terms.length) return []
  for (let i = 0; i < blocks.length; i++) {
    const continues = i + 1 < blocks.length && !pdfTextMatches(blocks[i].text, query) && !pdfTextMatches(blocks[i + 1].text, query) && blocks[i + 1].page - blocks[i].page <= 1
      && pdfTextMatches(blocks[i].text + " " + blocks[i + 1].text, query)
    if (!terms.some((term) => pdfTextMatches(blocks[i].text, term)) && !continues) continue
    let start = i
    while (start > 0 && i - start < 20 && !heading(blocks[start]) && blocks[i].page - blocks[start - 1].page <= 1) start--
    while (start > 0 && heading(blocks[start]) && heading(blocks[start - 1]) && blocks[start].page === blocks[start - 1].page) start--
    // Without a nearby structural heading, keep a small local context rather than an entire page.
    if (!heading(blocks[start])) start = Math.max(0, i - 2)
    let end = i + 1
    while (end < blocks.length && end - start < 40 && (!heading(blocks[end]) || blocks.slice(start, end).every(heading) || end === i + 1 && continues) && blocks[end].page - blocks[i].page <= 1) end++
    const existing = groups.get(start)
    if (existing) { existing.end = Math.max(existing.end, end); existing.anchors.push(blocks[i].id) }
    else groups.set(start, { start, end, anchors: [blocks[i].id] })
  }
  // Windows without headings may overlap. Merge them so a passage appears once.
  const merged: Array<{ start: number; end: number; anchors: string[] }> = []
  for (const group of [...groups.values()].sort((a, b) => a.start - b.start)) {
    const previous = merged.at(-1)
    if (previous && group.start < previous.end && group.end - previous.start <= 48) {
      previous.end = Math.max(previous.end, group.end); previous.anchors.push(...group.anchors)
    } else merged.push(group)
  }
  return merged.filter(({ start, end }) => pdfTextMatches(blocks.slice(start, end).map((b) => b.text).join(" "), query)).map(({ start, end, anchors }) => ({ id: blocks[start].id,
    title: blocks[start].text.length > 160 ? blocks[start].text.slice(0, 157) + "…" : blocks[start].text,
    anchorIds: [...new Set(anchors)], blocks: blocks.slice(start, end) }))
}

export function pdfResultTitle(candidate: PdfCandidate, decision: PdfDecision) {
  const selected = candidate.blocks.filter((b) => [...decision.blockIds, ...decision.partialIds].includes(b.id))
  const headerIndex = selected.findIndex(heading)
  let title = (selected[0] ?? candidate.blocks[0]).text
  if (headerIndex >= 0) {
    title = selected[headerIndex].text
    for (let i = headerIndex + 1; i < selected.length && heading(selected[i]) && selected[i].order === selected[i - 1].order + 1; i++) title += " " + selected[i].text
  }
  return title.length > 160 ? title.slice(0, 157) + "…" : title
}

export function chosenClefOption(value: unknown, options: string[]): string {
  if (typeof value === "string" && options.includes(value)) return value
  if (value && typeof value === "object") {
    const answer = value as Record<string, unknown>
    for (const key of ["choice", "selected", "value", "label"]) {
      if (typeof answer[key] === "string" && options.includes(answer[key] as string)) return answer[key] as string
    }
    const probabilities = (answer.probabilities ?? answer) as Record<string, unknown>
    if (options.every((key) => typeof probabilities[key] === "number" && Number.isFinite(probabilities[key]) && (probabilities[key] as number) >= 0)) {
      const sorted = options.slice().sort((a, b) => Number(probabilities[b]) - Number(probabilities[a]))
      if (Number(probabilities[sorted[0]]) > Number(probabilities[sorted[1]])) return sorted[0]
    }
  }
  throw new Error("Clef devolvió una decisión no reconocible; no se admitieron resultados sin validar.")
}

export function pdfEvaluationCacheKey(hash: string, query: string) {
  return `${PDF_EXTRACTION_VERSION}:${PDF_FILTER_VERSION}:${hash}:${normalizePdfQuery(query)}`
}
