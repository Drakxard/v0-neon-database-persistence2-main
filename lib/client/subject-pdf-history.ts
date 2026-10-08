"use client"

import { PDF_EXTRACTION_VERSION, PDF_FILTER_VERSION, normalizePdfQuery, type PdfSearchResult } from "../subject-pdf-search"
import type { PreparedPdf, PreparedTheory } from "./subject-pdf-search"
import { inPdfCacheQueue, pdfWorkspaceRoot, readPdfCache, writePdfCache } from "./subject-pdf-cache"
import { pdfHash } from "./subject-pdf-files"
import { readPdfCorrection } from "./subject-pdf-corrections"

type History = { source: string; queries: Record<string, PdfSearchResult[]> }
export type SavedPdfSearch = { query: string; results: PdfSearchResult[]; complete: boolean }
const pathFor = (file: PreparedPdf) => {
  const subject = encodeURIComponent(file.material.subject_id).replace(/\./g, "%2E")
  return `manifests/subject-voice/search-history/${subject}/${file.material.week_number}/${file.material.container_id}/${PDF_EXTRACTION_VERSION}/${file.hash}/${PDF_FILTER_VERSION}/search-history-v2.json`
}
const sourceFor = (file: PreparedPdf) => pdfHash(new File([JSON.stringify(file.blocks)], "source.txt"))

export async function savePdfSearch(file: PreparedPdf, query: string, results: PdfSearchResult[]) {
  const root = await pdfWorkspaceRoot(), path = pathFor(file), source = await sourceFor(file)
  await inPdfCacheQueue(root, path, async () => {
    const previous = await readPdfCache<History>(root, path)
    const history = previous?.source === source ? previous : { source, queries: {} }
    history.queries[query] = results
    await writePdfCache(root, path, history)
  })
}

export async function loadSavedPdfSearches(theory: PreparedTheory, signal: AbortSignal): Promise<SavedPdfSearch[]> {
  const root = await pdfWorkspaceRoot(), queries = new Map<string, {results:PdfSearchResult[]; files:number}>()
  for (const file of theory.files) {
    signal.throwIfAborted()
    const history = await readPdfCache<History>(root, pathFor(file))
    if (!history || history.source !== await sourceFor(file)) continue
    for (const [query, results] of Object.entries(history.queries)) {
      const saved = queries.get(query) ?? {results:[],files:0}
      saved.files++
      for (const original of results) {
        signal.throwIfAborted()
        // Metadata and scope always come from the current selection, even for identical PDF bytes.
        const result = {...original, id:`${file.material.id}:${file.hash}:${original.candidate.id}`,
          fileId:file.material.drive_file_id, fileName:file.material.file_name, week:theory.week!}
        if (!(await readPdfCorrection(result)).hidden) saved.results.push(result)
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
