"use client"

import { PDF_EXTRACTION_VERSION, PDF_FILTER_VERSION, normalizePdfQuery, type PdfSearchResult } from "../subject-pdf-search"
import type { PreparedPdf, PreparedTheory } from "./subject-pdf-search"
import { inPdfCacheQueue, pdfWorkspaceRoot, readPdfCache, writePdfCache } from "./subject-pdf-cache"
import { pdfHash } from "./subject-pdf-files"
import { readPdfCorrection } from "./subject-pdf-corrections"
import { importLegacyPdfDiscard, loadDiscardHistory } from "./subject-discard-history"

type History = { source: string; queries: Record<string, PdfSearchResult[]> }
const validHistory = (value: History) => typeof value.source === "string" && Boolean(value.queries) && typeof value.queries === "object" &&
  Object.values(value.queries).every(results => Array.isArray(results) && results.every(result => Boolean(result) && typeof result.query === "string" &&
    Array.isArray(result.candidate?.blocks) && Array.isArray(result.candidate?.anchorIds) && Array.isArray(result.decision?.blockIds) && Array.isArray(result.decision?.partialIds)))
export type SavedPdfSearch = { query: string; results: PdfSearchResult[]; complete: boolean }
const pathFor = (file: PreparedPdf, version = PDF_FILTER_VERSION) => {
  const subject = encodeURIComponent(file.material.subject_id).replace(/\./g, "%2E")
  return `manifests/subject-voice/search-history/${subject}/${file.material.week_number}/${file.material.container_id}/${PDF_EXTRACTION_VERSION}/${file.hash}/${version}/search-history-v2.json`
}
const sourceFor = (file: PreparedPdf) => pdfHash(new File([JSON.stringify(file.blocks)], "source.txt"))

export async function savePdfSearch(file: PreparedPdf, query: string, results: PdfSearchResult[]) {
  const root = await pdfWorkspaceRoot(), path = pathFor(file), source = await sourceFor(file)
  await inPdfCacheQueue(root, path, async () => {
    const previous = await readPdfCache<History>(root, path, { valid: validHistory })
    const history = previous?.source === source ? previous : { source, queries: {} }
    history.queries[query] = results
    await writePdfCache(root, path, history)
  })
}

export async function loadSavedPdfSearches(theory: PreparedTheory, signal: AbortSignal): Promise<SavedPdfSearch[]> {
  const root = await pdfWorkspaceRoot(), queries = new Map<string, {results:PdfSearchResult[]; files:number}>()
  const restored = (theory.files.length ? await loadDiscardHistory(theory.files[0].material.subject_id) : []).filter(entry => entry.legacy && entry.undone && entry.result)
  for (const file of theory.files) {
    signal.throwIfAborted()
    const modern = await readPdfCache<History>(root, pathFor(file), { valid: validHistory })
    let legacy: History | null = null
    try { legacy = await readPdfCache<History>(root, pathFor(file, "clef-fragments-v1"), { valid: validHistory }) }
    catch (error) { if (!modern) throw error }
    const source = await sourceFor(file)
    const modernQueries = modern?.source === source ? modern.queries : {}
    const previous = { ...(legacy?.source === source ? legacy.queries : {}), ...modernQueries }
    const current: Record<string, PdfSearchResult[]> = Object.fromEntries(Object.entries(previous).map(([query, results]) => [query, [...results]]))
    for (const entry of restored) {
      const result = entry.result!
      if (result.hash !== file.hash || !result.candidate.anchorIds.every(id => file.blocks.some(block => block.id === id))) continue
      const results = current[result.query] ??= []
      if (!results.some(item => item.candidate.id === result.candidate.id)) results.push(result)
    }
    for (const [query, results] of Object.entries(current)) {
      const fromLegacy = !Object.hasOwn(modernQueries, query)
      if (fromLegacy && !results.length) continue
      const saved = queries.get(query) ?? {results:[],files:0}
      saved.files++
      for (const original of results) {
        signal.throwIfAborted()
        // Metadata and scope always come from the current selection, even for identical PDF bytes.
        const result = {...original, ...(fromLegacy ? { decision: { ...original.decision, blockIds: original.candidate.blocks.map(block => block.id), partialIds: [] } } : {}), id:`${file.material.id}:${file.hash}:${original.candidate.id}`,
          fileId:file.material.drive_file_id, fileName:file.material.file_name, week:theory.week!}
        if (!(await readPdfCorrection(result)).hidden || !await importLegacyPdfDiscard(file.material.subject_id, result)) saved.results.push(result)
      }
      queries.set(query,saved)
    }
  }
  return [...queries].map(([query,saved]) => ({query,results:saved.results,complete:saved.files===theory.files.length}))
}

export function findSavedPdfSearch(history: SavedPdfSearch[], query: string) {
  const normalized = normalizePdfQuery(query)
  if (!normalized) return null
  const exact = history.find((item) => item.query === normalized)
  if (exact?.results.length) return {...exact, exact:true, previewOnly:false}
  const prefixes = history.filter((item) => item.query.startsWith(normalized) && item.results.length)
  if (!prefixes.length) return exact ? {...exact,exact:true,previewOnly:false} : null
  const unique = new Map<string,PdfSearchResult>()
  for (const item of prefixes) for (const result of item.results) if (!unique.has(result.id)) unique.set(result.id,result)
  // A complete shorter phrase remains a new search and must evaluate its additional candidates.
  const previewOnly = prefixes.every((item) => item.query[normalized.length] !== " ")
  return {query:normalized,results:[...unique.values()],complete:false,exact:false,previewOnly}
}
