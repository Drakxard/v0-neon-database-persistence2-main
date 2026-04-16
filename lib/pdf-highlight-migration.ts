import path from "node:path"
import { pathToFileURL } from "node:url"

type PdfJsModule = {
  getDocument: (params: Record<string, unknown>) => {
    promise: Promise<PdfDocumentProxyLike>
  }
  AnnotationEditorType: {
    HIGHLIGHT: number
  }
}

export type HighlightSnapshotItem = {
  annotationId: string
  pageIndex: number
  rect: [number, number, number, number]
  quadPoints: number[]
  color: [number, number, number]
  opacity: number
  exactQuote: string
  prefixQuote: string
  suffixQuote: string
  sourceFingerprint: string
}

export type HighlightMigrationCandidate = {
  pageIndex: number
  rect: [number, number, number, number]
  quadPoints: number[]
  exactQuote: string
  prefixMatch: boolean
  suffixMatch: boolean
  pageDistance: number
}

export type HighlightMigrationMatch = {
  highlight: HighlightSnapshotItem
  candidate: HighlightMigrationCandidate
  score: number
  reason: string
}

export type HighlightMigrationUnmatched = {
  highlight: HighlightSnapshotItem
  reason: string
}

export type HighlightMigrationPreview = {
  candidateFileName: string
  sourceFingerprint: string
  candidateFingerprint: string
  autoMatches: HighlightMigrationMatch[]
  reviewMatches: HighlightMigrationMatch[]
  unmatched: HighlightMigrationUnmatched[]
  summary: {
    totalHighlights: number
    autoMatches: number
    reviewMatches: number
    unmatched: number
  }
}

export type HighlightMigrationDecision = {
  annotationId: string
  action: "accept" | "discard" | "skip"
}

type TextToken = {
  text: string
  start: number
  end: number
  rect: [number, number, number, number]
}

type PageTextModel = {
  pageIndex: number
  text: string
  tokens: TextToken[]
  pageRect: [number, number, number, number]
}

type ExtractedSnapshot = {
  sourceFingerprint: string
  snapshot: HighlightSnapshotItem[]
  unmatched: HighlightMigrationUnmatched[]
}

type PdfDocumentProxyLike = {
  fingerprints?: [string | null, string | null]
  numPages: number
  getPage(pageNumber: number): Promise<{
    view: [number, number, number, number]
    getTextContent(): Promise<{ items: Array<Record<string, unknown>> }>
    getAnnotations(): Promise<Array<Record<string, unknown>>>
  }>
  saveDocument?(): Promise<Uint8Array>
  annotationStorage?: {
    setValue(key: string, value: unknown): void
  }
  destroy?(): void
}

const DEFAULT_HIGHLIGHT_COLOR: [number, number, number] = [255, 240, 102]
const DEFAULT_HIGHLIGHT_OPACITY = 1
const MAX_CONTEXT_LENGTH = 64
const MIN_SELECTABLE_TEXT = 24

let cachedPdfJsModule: Promise<PdfJsModule> | null = null
const runtimeImport = new Function("moduleUrl", "return import(moduleUrl)") as (
  moduleUrl: string
) => Promise<PdfJsModule>

function installPdfJsNodePolyfills() {
  const promiseCtor = Promise as PromiseConstructor & {
    try?: <T>(fn: (...args: never[]) => T | Promise<T>) => Promise<T>
  }
  if (!promiseCtor.try) {
    promiseCtor.try = async (fn) => fn()
  }

  const uint8Proto = Uint8Array.prototype as Uint8Array & {
    toHex?: () => string
  }
  if (typeof uint8Proto.toHex !== "function") {
    Object.defineProperty(Uint8Array.prototype, "toHex", {
      configurable: true,
      value(this: Uint8Array) {
        return Buffer.from(this).toString("hex")
      },
    })
  }

  if (typeof globalThis.DOMMatrix !== "function") {
    class DOMMatrixPolyfill {
      constructor(_init?: unknown) {}
      multiplySelf() {
        return this
      }
      preMultiplySelf() {
        return this
      }
      translate() {
        return this
      }
      scale() {
        return this
      }
      invertSelf() {
        return this
      }
    }

    globalThis.DOMMatrix = DOMMatrixPolyfill as typeof DOMMatrix
  }

  if (typeof globalThis.ImageData !== "function") {
    class ImageDataPolyfill {
      data: Uint8ClampedArray
      width: number
      height: number

      constructor(data: Uint8ClampedArray, width: number, height: number) {
        this.data = data
        this.width = width
        this.height = height
      }
    }

    globalThis.ImageData = ImageDataPolyfill as typeof ImageData
  }

  if (typeof globalThis.Path2D !== "function") {
    class Path2DPolyfill {
      addPath() {}
    }

    globalThis.Path2D = Path2DPolyfill as unknown as typeof Path2D
  }
}

async function getPdfJsModule() {
  if (!cachedPdfJsModule) {
    cachedPdfJsModule = (async () => {
      installPdfJsNodePolyfills()
      const moduleUrl = pathToFileURL(path.join(process.cwd(), "public", "pdfjs", "build", "pdf.mjs")).href
      return runtimeImport(moduleUrl)
    })()
  }

  return cachedPdfJsModule
}

async function openPdfDocument(pdfBytes: Uint8Array) {
  const pdfjs = await getPdfJsModule()
  const loadingTask = pdfjs.getDocument({
    data: pdfBytes,
    disableWorker: true,
    isEvalSupported: false,
    useSystemFonts: false,
  })
  const document = (await loadingTask.promise) as PdfDocumentProxyLike
  return { pdfjs, document }
}

function normalizeText(value: string) {
  return String(value || "").replace(/\s+/g, " ").trim()
}

function normalizeContextSnippet(value: string, takeFromEnd = false) {
  const normalized = normalizeText(value)
  if (!normalized) return ""
  return takeFromEnd ? normalized.slice(-MAX_CONTEXT_LENGTH) : normalized.slice(0, MAX_CONTEXT_LENGTH)
}

function normalizeNumberArray(value: unknown) {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => Number(item))
    .filter((item) => Number.isFinite(item))
}

function normalizeRect(value: unknown): [number, number, number, number] {
  const numbers = normalizeNumberArray(value)
  if (numbers.length < 4) {
    return [0, 0, 0, 0]
  }
  return [numbers[0], numbers[1], numbers[2], numbers[3]]
}

function normalizeColor(value: unknown): [number, number, number] {
  const numbers = normalizeNumberArray(value).slice(0, 3)
  if (numbers.length !== 3) {
    return [...DEFAULT_HIGHLIGHT_COLOR]
  }
  return [numbers[0], numbers[1], numbers[2]]
}

function clampOpacity(value: unknown) {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return DEFAULT_HIGHLIGHT_OPACITY
  return Math.max(0, Math.min(1, numeric))
}

function quadPointsToRects(quadPoints: number[]) {
  const rects: Array<[number, number, number, number]> = []
  for (let index = 0; index + 7 < quadPoints.length; index += 8) {
    const xs = [quadPoints[index], quadPoints[index + 2], quadPoints[index + 4], quadPoints[index + 6]]
    const ys = [quadPoints[index + 1], quadPoints[index + 3], quadPoints[index + 5], quadPoints[index + 7]]
    rects.push([Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)])
  }
  return rects
}

function rectsIntersect(left: [number, number, number, number], right: [number, number, number, number]) {
  return !(left[2] < right[0] || right[2] < left[0] || left[3] < right[1] || right[3] < left[1])
}

function mergeRects(rects: Array<[number, number, number, number]>): [number, number, number, number] {
  if (rects.length === 0) return [0, 0, 0, 0]
  return [
    Math.min(...rects.map((rect) => rect[0])),
    Math.min(...rects.map((rect) => rect[1])),
    Math.max(...rects.map((rect) => rect[2])),
    Math.max(...rects.map((rect) => rect[3])),
  ]
}

function getTokenRect(item: Record<string, unknown>): [number, number, number, number] | null {
  const transform = Array.isArray(item.transform) ? item.transform.map((entry) => Number(entry)) : []
  const width = Number(item.width)
  const height = Number(item.height)
  if (transform.length < 6 || !Number.isFinite(width) || !Number.isFinite(height)) {
    return null
  }

  const x1 = transform[4]
  const y2 = transform[5]
  const x2 = x1 + width
  const y1 = y2 - height
  if (![x1, y1, x2, y2].every((value) => Number.isFinite(value))) {
    return null
  }

  return [Math.min(x1, x2), Math.min(y1, y2), Math.max(x1, x2), Math.max(y1, y2)]
}

async function buildPageTextModel(document: PdfDocumentProxyLike, pageIndex: number): Promise<PageTextModel> {
  const page = await document.getPage(pageIndex + 1)
  const pageRect = page.view
  const textContent = await page.getTextContent()
  const tokens: TextToken[] = []
  let text = ""

  for (const rawItem of textContent.items) {
    const item = rawItem as Record<string, unknown>
    const tokenText = normalizeText(String(item.str || ""))
    const tokenRect = getTokenRect(item)
    if (!tokenText || !tokenRect) {
      continue
    }

    if (text.length > 0) {
      text += " "
    }

    const start = text.length
    text += tokenText
    const end = text.length
    tokens.push({
      text: tokenText,
      start,
      end,
      rect: tokenRect,
    })
  }

  return {
    pageIndex,
    text,
    tokens,
    pageRect: [pageRect[0], pageRect[1], pageRect[2], pageRect[3]],
  }
}

function extractQuoteFromTokenIndexes(model: PageTextModel, tokenIndexes: number[]) {
  if (tokenIndexes.length === 0) return null
  const startToken = model.tokens[tokenIndexes[0]]
  const endToken = model.tokens[tokenIndexes[tokenIndexes.length - 1]]
  if (!startToken || !endToken) return null

  const exactQuote = normalizeText(tokenIndexes.map((index) => model.tokens[index]?.text || "").join(" "))
  if (!exactQuote) return null

  const prefixQuote = normalizeContextSnippet(model.text.slice(Math.max(0, startToken.start - MAX_CONTEXT_LENGTH), startToken.start), true)
  const suffixQuote = normalizeContextSnippet(model.text.slice(endToken.end, endToken.end + MAX_CONTEXT_LENGTH))

  return {
    exactQuote,
    prefixQuote,
    suffixQuote,
  }
}

function buildSnapshotItem(params: {
  annotationId: string
  pageIndex: number
  rect: [number, number, number, number]
  quadPoints: number[]
  color: [number, number, number]
  opacity: number
  exactQuote: string
  prefixQuote: string
  suffixQuote: string
  sourceFingerprint: string
}): HighlightSnapshotItem {
  return {
    annotationId: String(params.annotationId),
    pageIndex: params.pageIndex,
    rect: params.rect,
    quadPoints: [...params.quadPoints],
    color: [...params.color] as [number, number, number],
    opacity: params.opacity,
    exactQuote: normalizeText(params.exactQuote),
    prefixQuote: normalizeContextSnippet(params.prefixQuote, true),
    suffixQuote: normalizeContextSnippet(params.suffixQuote),
    sourceFingerprint: String(params.sourceFingerprint || ""),
  }
}

function getHighlightTokenIndexesFromQuads(model: PageTextModel, quadPoints: number[]) {
  const quadRects = quadPointsToRects(quadPoints)
  const indexes: number[] = []
  model.tokens.forEach((token, index) => {
    if (quadRects.some((quadRect) => rectsIntersect(quadRect, token.rect))) {
      indexes.push(index)
    }
  })
  return indexes
}

function pageDistanceScore(distance: number) {
  if (distance === 0) return 10
  if (distance === 1) return 8
  return 0
}

function buildCandidateReason(prefixMatch: boolean, suffixMatch: boolean, pageDistance: number) {
  const pageReason = pageDistance === 0 ? "misma pagina" : pageDistance === 1 ? "pagina cercana" : "pagina distinta"
  if (prefixMatch && suffixMatch) return `Coincide el texto exacto y ambos contextos en ${pageReason}.`
  if (prefixMatch || suffixMatch) return `Coincide el texto exacto y un contexto en ${pageReason}.`
  return `Coincide el texto exacto sin contexto fuerte en ${pageReason}.`
}

function buildOccurrenceCandidate(
  highlight: HighlightSnapshotItem,
  model: PageTextModel,
  occurrenceIndex: number
): HighlightMigrationMatch | null {
  const occurrenceEnd = occurrenceIndex + highlight.exactQuote.length
  const tokenIndexes = model.tokens.flatMap((token, tokenIndex) =>
    token.end <= occurrenceIndex || token.start >= occurrenceEnd ? [] : [tokenIndex]
  )

  if (tokenIndexes.length === 0) {
    return null
  }

  const tokenRects = tokenIndexes.map((tokenIndex) => model.tokens[tokenIndex].rect)
  const lineRects: Array<[number, number, number, number]> = []
  for (const rect of tokenRects) {
    const centerY = (rect[1] + rect[3]) / 2
    const existingLine = lineRects.find((lineRect) => Math.abs((lineRect[1] + lineRect[3]) / 2 - centerY) <= Math.max(4, (rect[3] - rect[1]) * 0.75))
    if (existingLine) {
      existingLine[0] = Math.min(existingLine[0], rect[0])
      existingLine[1] = Math.min(existingLine[1], rect[1])
      existingLine[2] = Math.max(existingLine[2], rect[2])
      existingLine[3] = Math.max(existingLine[3], rect[3])
    } else {
      lineRects.push([...rect])
    }
  }

  lineRects.sort((left, right) => right[3] - left[3] || left[0] - right[0])

  const quadPoints = lineRects.flatMap(([x1, y1, x2, y2]) => [x1, y2, x2, y2, x1, y1, x2, y1])
  const candidateRect = mergeRects(lineRects)
  const pageDistance = Math.abs(model.pageIndex - highlight.pageIndex)
  const prefixSample = normalizeContextSnippet(model.text.slice(Math.max(0, occurrenceIndex - highlight.prefixQuote.length), occurrenceIndex), true)
  const suffixSample = normalizeContextSnippet(model.text.slice(occurrenceEnd, occurrenceEnd + highlight.suffixQuote.length))
  const prefixMatch = Boolean(highlight.prefixQuote) && prefixSample === highlight.prefixQuote
  const suffixMatch = Boolean(highlight.suffixQuote) && suffixSample === highlight.suffixQuote
  const score = 50 + (prefixMatch ? 15 : 0) + (suffixMatch ? 15 : 0) + pageDistanceScore(pageDistance)

  return {
    highlight,
    candidate: {
      pageIndex: model.pageIndex,
      rect: candidateRect,
      quadPoints,
      exactQuote: highlight.exactQuote,
      prefixMatch,
      suffixMatch,
      pageDistance,
    },
    score,
    reason: buildCandidateReason(prefixMatch, suffixMatch, pageDistance),
  }
}

function listSearchPageIndexes(totalPages: number, pageIndex: number) {
  const preferred = [pageIndex, pageIndex - 1, pageIndex + 1].filter((index) => index >= 0 && index < totalPages)
  const rest = Array.from({ length: totalPages }, (_, index) => index).filter((index) => !preferred.includes(index))
  return [...preferred, ...rest]
}

function findMatchesForHighlight(highlight: HighlightSnapshotItem, pageModels: PageTextModel[]) {
  const searchPageIndexes = listSearchPageIndexes(pageModels.length, highlight.pageIndex)
  const matches: HighlightMigrationMatch[] = []

  for (const pageIndex of searchPageIndexes) {
    const model = pageModels[pageIndex]
    if (!model?.text) continue
    let searchOffset = 0
    while (true) {
      const occurrenceIndex = model.text.indexOf(highlight.exactQuote, searchOffset)
      if (occurrenceIndex === -1) break
      const candidate = buildOccurrenceCandidate(highlight, model, occurrenceIndex)
      if (candidate) {
        matches.push(candidate)
      }
      searchOffset = occurrenceIndex + highlight.exactQuote.length
    }
  }

  matches.sort((left, right) => right.score - left.score || left.candidate.pageDistance - right.candidate.pageDistance)
  return matches
}

function isSelectablePdf(pageModels: PageTextModel[]) {
  const textLength = pageModels.reduce((total, model) => total + model.text.length, 0)
  return textLength >= MIN_SELECTABLE_TEXT && pageModels.some((model) => model.tokens.length > 0)
}

export function parseHighlightSnapshot(value: unknown) {
  let parsed = value
  if (typeof parsed === "string") {
    parsed = JSON.parse(parsed)
  }

  if (!Array.isArray(parsed)) {
    return []
  }

  return parsed.flatMap((item, index) => {
    if (!item || typeof item !== "object") return []
    const record = item as Record<string, unknown>
    const exactQuote = normalizeText(String(record.exactQuote || ""))
    const quadPoints = normalizeNumberArray(record.quadPoints)
    if (!quadPoints.length) return []

    return [
      buildSnapshotItem({
        annotationId: String(record.annotationId || `highlight-${index + 1}`),
        pageIndex: Number(record.pageIndex) || 0,
        rect: normalizeRect(record.rect),
        quadPoints,
        color: normalizeColor(record.color),
        opacity: clampOpacity(record.opacity),
        exactQuote,
        prefixQuote: String(record.prefixQuote || ""),
        suffixQuote: String(record.suffixQuote || ""),
        sourceFingerprint: String(record.sourceFingerprint || ""),
      }),
    ]
  })
}

export async function extractHighlightSnapshotFromPdfBytes(pdfBytes: Uint8Array, explicitFingerprint?: string): Promise<ExtractedSnapshot> {
  const { document } = await openPdfDocument(pdfBytes)
  try {
    const sourceFingerprint = explicitFingerprint || document.fingerprints?.[0] || ""
    const snapshot: HighlightSnapshotItem[] = []
    const unmatched: HighlightMigrationUnmatched[] = []

    for (let pageIndex = 0; pageIndex < document.numPages; pageIndex += 1) {
      const page = await document.getPage(pageIndex + 1)
      const pageModel = await buildPageTextModel(document, pageIndex)
      const annotations = await page.getAnnotations()

      annotations.forEach((annotation, annotationIndex) => {
        const subtype = String(annotation.subtype || "").toLowerCase()
        const rawQuadPoints = normalizeNumberArray(annotation.quadPoints)
        if (subtype !== "highlight" || rawQuadPoints.length === 0) {
          return
        }

        const tokenIndexes = getHighlightTokenIndexesFromQuads(pageModel, rawQuadPoints)
        const quote = extractQuoteFromTokenIndexes(pageModel, tokenIndexes)
        const baseItem = buildSnapshotItem({
          annotationId: String(annotation.id || `legacy-${pageIndex + 1}-${annotationIndex + 1}`),
          pageIndex,
          rect: normalizeRect(annotation.rect),
          quadPoints: rawQuadPoints,
          color: normalizeColor(annotation.color),
          opacity: clampOpacity(annotation.opacity),
          exactQuote: quote?.exactQuote || "",
          prefixQuote: quote?.prefixQuote || "",
          suffixQuote: quote?.suffixQuote || "",
          sourceFingerprint,
        })

        if (!quote?.exactQuote) {
          unmatched.push({
            highlight: baseItem,
            reason: "No se pudo reconstruir texto confiable desde el PDF actual.",
          })
          return
        }

        snapshot.push(baseItem)
      })
    }

    return {
      sourceFingerprint,
      snapshot,
      unmatched,
    }
  } finally {
    document.destroy?.()
  }
}

export async function buildHighlightMigrationPreview(params: {
  sourceHighlights: HighlightSnapshotItem[]
  candidatePdfBytes: Uint8Array
  candidateFileName: string
  sourceFingerprint: string
}): Promise<HighlightMigrationPreview> {
  const { document } = await openPdfDocument(params.candidatePdfBytes)
  try {
    const pageModels = await Promise.all(
      Array.from({ length: document.numPages }, (_, pageIndex) => buildPageTextModel(document, pageIndex))
    )

    if (!isSelectablePdf(pageModels)) {
      throw new Error("El PDF nuevo no tiene texto seleccionable suficiente para migrar resaltados.")
    }

    const autoMatches: HighlightMigrationMatch[] = []
    const reviewMatches: HighlightMigrationMatch[] = []
    const unmatched: HighlightMigrationUnmatched[] = []
    const candidateFingerprint = document.fingerprints?.[0] || ""

    for (const highlight of params.sourceHighlights) {
      if (!highlight.exactQuote) {
        unmatched.push({
          highlight,
          reason: "El highlight no tiene texto base para buscar en la nueva version.",
        })
        continue
      }

      const bestMatch = findMatchesForHighlight(highlight, pageModels)[0]
      if (!bestMatch) {
        unmatched.push({
          highlight,
          reason: "No se encontro el texto exacto en el PDF nuevo.",
        })
        continue
      }

      if (bestMatch.score >= 85) {
        autoMatches.push(bestMatch)
      } else if (bestMatch.score >= 60) {
        reviewMatches.push(bestMatch)
      } else {
        unmatched.push({
          highlight,
          reason: bestMatch.reason,
        })
      }
    }

    return {
      candidateFileName: params.candidateFileName,
      sourceFingerprint: params.sourceFingerprint,
      candidateFingerprint,
      autoMatches,
      reviewMatches,
      unmatched,
      summary: {
        totalHighlights: params.sourceHighlights.length,
        autoMatches: autoMatches.length,
        reviewMatches: reviewMatches.length,
        unmatched: unmatched.length,
      },
    }
  } finally {
    document.destroy?.()
  }
}

function getHighlightBoxesFromQuadPoints(
  quadPoints: number[],
  pageRect: [number, number, number, number]
) {
  const pageWidth = pageRect[2] - pageRect[0]
  const pageHeight = pageRect[3] - pageRect[1]
  const boxes: Array<{ x: number; y: number; width: number; height: number }> = []

  for (let index = 0; index + 7 < quadPoints.length; index += 8) {
    const left = quadPoints[index]
    const top = quadPoints[index + 1]
    const right = quadPoints[index + 2]
    const bottom = quadPoints[index + 5]
    boxes.push({
      x: (left - pageRect[0]) / pageWidth,
      y: 1 - (top - pageRect[1]) / pageHeight,
      width: (right - left) / pageWidth,
      height: (top - bottom) / pageHeight,
    })
  }

  return boxes
}

export async function applyHighlightMigrationToPdf(params: {
  candidatePdfBytes: Uint8Array
  matches: HighlightMigrationMatch[]
  candidateFingerprint?: string
}) {
  if (params.matches.length === 0) {
    return {
      pdfBytes: params.candidatePdfBytes,
      snapshot: [] as HighlightSnapshotItem[],
      candidateFingerprint: params.candidateFingerprint || "",
    }
  }

  const { pdfjs, document } = await openPdfDocument(params.candidatePdfBytes)
  try {
    const annotationStorage = document.annotationStorage
    const HighlightOutliner = (globalThis as typeof globalThis & {
      _pdfjsTestingUtils?: {
        HighlightOutliner?: new (
          boxes: Array<{ x: number; y: number; width: number; height: number }>,
          borderWidth?: number,
          innerMargin?: number,
          isLTR?: boolean
        ) => {
          getOutlines(): {
            serialize(rect: [number, number, number, number], rotation: number): number[][]
          }
        }
      }
    })._pdfjsTestingUtils?.HighlightOutliner

    if (!annotationStorage || typeof annotationStorage.setValue !== "function" || typeof document.saveDocument !== "function" || !HighlightOutliner) {
      throw new Error("PDF.js no expone la serializacion necesaria para reaplicar highlights.")
    }

    const appliedSnapshot: HighlightSnapshotItem[] = []
    const pageRects = new Map<number, [number, number, number, number]>()

    for (const match of params.matches) {
      if (!pageRects.has(match.candidate.pageIndex)) {
        const page = await document.getPage(match.candidate.pageIndex + 1)
        pageRects.set(match.candidate.pageIndex, [page.view[0], page.view[1], page.view[2], page.view[3]])
      }

      const pageRect = pageRects.get(match.candidate.pageIndex)!
      const boxes = getHighlightBoxesFromQuadPoints(match.candidate.quadPoints, pageRect)
      const outliner = new HighlightOutliner(boxes, 0.001)
      const outlines = outliner.getOutlines().serialize(match.candidate.rect, 0)
      annotationStorage.setValue(`migrated-${match.highlight.annotationId}`, {
        annotationType: pdfjs.AnnotationEditorType.HIGHLIGHT,
        color: match.highlight.color,
        opacity: match.highlight.opacity,
        thickness: 12,
        quadPoints: Float32Array.from(match.candidate.quadPoints),
        outlines,
        pageIndex: match.candidate.pageIndex,
        rect: match.candidate.rect,
        rotation: 0,
        id: null,
        deleted: false,
      })

      appliedSnapshot.push(
        buildSnapshotItem({
          annotationId: match.highlight.annotationId,
          pageIndex: match.candidate.pageIndex,
          rect: match.candidate.rect,
          quadPoints: match.candidate.quadPoints,
          color: match.highlight.color,
          opacity: match.highlight.opacity,
          exactQuote: match.highlight.exactQuote,
          prefixQuote: match.highlight.prefixQuote,
          suffixQuote: match.highlight.suffixQuote,
          sourceFingerprint: params.candidateFingerprint || document.fingerprints?.[0] || "",
        })
      )
    }

    const pdfBytes = await document.saveDocument()
    return {
      pdfBytes,
      snapshot: appliedSnapshot,
      candidateFingerprint: params.candidateFingerprint || document.fingerprints?.[0] || "",
    }
  } finally {
    document.destroy?.()
  }
}
