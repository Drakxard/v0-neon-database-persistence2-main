"use client"

import { getWorkspaceFile, listLocalSubjectDayMaterials, listLocalSubjectMaterialContainers, listLocalSubjectWeekNumbersWithContent } from "../local-workspace-data"
import { getReadyInscreenConfigToken } from "../local-workspace-client"
import { buildPdfCandidates, normalizePdfQuery, parsePdfExtraction, pdfResultTitle, PDF_EXTRACTION_VERSION, PDF_FILTER_VERSION, type PdfBlock, type PdfDecision, type PdfExtraction, type PdfSearchResult } from "../subject-pdf-search"
import { inPdfCacheQueue, pdfWorkspaceRoot, readPdfCache, writePdfCache } from "./subject-pdf-cache"
import { pdfHash, splitPdfBatches } from "./subject-pdf-files"
import type { SubjectDayMaterial } from "../study-types"
import { readPdfCorrection } from "./subject-pdf-corrections"
import { savePdfSearch } from "./subject-pdf-history"
import { isManualTopicsQuery } from "../subject-voice-search"

type BatchState = { pages: number[]; token?: string; extraction?: PdfExtraction; error?: string }
type ExtractionCache = { version: string; hash: string; complete: boolean; batches: BatchState[] }
export type PreparedPdf = { material: SubjectDayMaterial; hash: string; blocks: PdfBlock[] }
export type PreparedTheory = { week: number | null; files: PreparedPdf[]; errors: string[]; signature: string }
export function theoryScopeSignature(scope: { week: number | null; materials: SubjectDayMaterial[] }) {
  return JSON.stringify([scope.week, scope.materials.map((m) => [m.id, m.drive_file_id, m.updated_at])])
}
const extractionPath = (hash: string) => `manifests/subject-voice/pdf/${PDF_EXTRACTION_VERSION}/${hash}/extraction.json`
function headers() {
  const token = getReadyInscreenConfigToken()
  return token ? { "x-inscreen-config-token": token } : undefined
}
async function responseJson<T>(response: Response): Promise<T> {
  const data = await response.json().catch(() => null)
  if (!response.ok) throw new Error(data?.error ?? `No se pudo procesar el PDF (HTTP ${response.status}).`)
  if (!data || typeof data !== "object") throw new Error("El servicio devolvió una respuesta inválida.")
  return data as T
}
function delay(signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const abort = () => { clearTimeout(timer); reject(signal.reason) }
    const timer = setTimeout(() => { signal.removeEventListener("abort", abort); resolve() }, 1500)
    signal.addEventListener("abort", abort, { once: true })
    if (signal.aborted) abort()
  })
}
async function finishJob(token: string, signal: AbortSignal) {
  const deadline = Date.now() + 10 * 60 * 1000
  while (Date.now() < deadline) {
    signal.throwIfAborted()
    const result = await responseJson<{ status: string; payload?: Record<string, unknown> }>(await fetch(`/api/subject-voice/pdf-extraction?${new URLSearchParams({ token })}`, { headers: headers(), signal, cache: "no-store" }))
    if (result.status === "complete" && result.payload) return result.payload
    if (result.status !== "processing") throw new Error("El estado de extracción no es válido.")
    await delay(signal)
  }
  throw new Error("La extracción sigue pendiente. Reintentá para continuar el seguimiento.")
}
async function submit(file: File, words = false) {
  const form = new FormData(); form.set("file", file); if (words) form.set("words", "true")
  // Do not cancel submission on navigation: persist the accepted job before honoring cancellation.
  const job = await responseJson<{ token: string }>(await fetch("/api/subject-voice/pdf-extraction", { method: "POST", headers: headers(), body: form, signal: AbortSignal.timeout(55_000) }))
  if (typeof job.token !== "string" || !job.token) throw new Error("Falta el identificador de extracción.")
  return job.token
}
export async function latestTheoryMaterials(subjectId: string) {
  const containers = await listLocalSubjectMaterialContainers(subjectId)
  const theory = containers.find((c) => c.kind === "theory")
  if (!theory) return { week: null, materials: [] as SubjectDayMaterial[] }
  for (const week of await listLocalSubjectWeekNumbersWithContent(subjectId)) {
    const materials = (await listLocalSubjectDayMaterials({ subjectId, weekNumber: week }))
      .filter((m) => m.container_id === theory.id && (m.drive_mime_type === "application/pdf" || /\.pdf$/i.test(m.file_name)))
    if (materials.length) return { week, materials }
  }
  return { week: null, materials: [] as SubjectDayMaterial[] }
}
export type PdfPreparationProgress = { current: number; total: number }
export async function prepareTheoryPdfs(subjectId: string, signal: AbortSignal, progress: (value: PdfPreparationProgress | null) => void): Promise<PreparedTheory> {
  const root = await pdfWorkspaceRoot()
  const { week, materials } = await latestTheoryMaterials(subjectId)
  const result: PreparedTheory = { week, files: [], errors: [], signature: theoryScopeSignature({ week, materials }) }
  const inputs: Array<{ material: SubjectDayMaterial; file: File; hash: string }> = []
  const pendingHashes = new Set<string>(), startedHashes = new Set<string>(), finishedHashes = new Set<string>()
  // Count only documents whose extraction is missing or incomplete. Reading a complete cache is silent.
  for (const material of materials) {
    signal.throwIfAborted()
    try {
      const file = await getWorkspaceFile(material.drive_file_id), hash = await pdfHash(file)
      const saved = await readPdfCache<ExtractionCache>(root, extractionPath(hash))
      inputs.push({ material, file, hash })
      if (!saved?.complete) pendingHashes.add(hash)
    } catch (error) {
      signal.throwIfAborted()
      result.errors.push(`${material.file_name}: ${error instanceof Error ? error.message : "No se pudo preparar."}`)
    }
  }
  for (const { material, file, hash } of inputs) {
    signal.throwIfAborted()
    try {
      const cache = await inPdfCacheQueue(root, hash, async () => {
        signal.throwIfAborted()
        const path = extractionPath(hash)
        const saved = await readPdfCache<ExtractionCache>(root, path)
        if (saved && (saved.version !== PDF_EXTRACTION_VERSION || saved.hash !== hash || !Array.isArray(saved.batches))) throw new Error("La caché de extracción no es válida.")
        const state: ExtractionCache = saved ?? { version: PDF_EXTRACTION_VERSION, hash, complete: false, batches: [] }
        if (state.complete) return state
        pendingHashes.add(hash)
        startedHashes.add(hash)
        progress({ current: startedHashes.size, total: pendingHashes.size })
        let index = 0
        for await (const batch of splitPdfBatches(file, signal)) {
          let current = state.batches[index]
          if (current && JSON.stringify(current.pages) !== JSON.stringify(batch.pages)) throw new Error("Los lotes guardados no corresponden al PDF actual.")
          if (!current) { current = { pages: batch.pages }; state.batches[index] = current }
          index++
          if (current.extraction && !current.extraction.failedPages.length) continue
          if ("error" in batch) { current.error = batch.error; await writePdfCache(root, path, state); continue }
          try {
            if (!current.token) { current.token = await submit(batch.file); await writePdfCache(root, path, state) }
            const payload = await finishJob(current.token, signal)
            current.extraction = parsePdfExtraction(payload, batch.pages)
            delete current.error; delete current.token
            await writePdfCache(root, path, state)
          } catch (error) {
            signal.throwIfAborted()
            // Keep transient pending jobs. Expired/failed jobs can be resubmitted on explicit retry.
            const message = error instanceof Error ? error.message : "No se pudo extraer el lote."
            if (/venció|no pudo completar/.test(message)) delete current.token
            current.error = message
            await writePdfCache(root, path, state)
          }
        }
        state.complete = state.batches.every((b) => Boolean(b.extraction) && !b.extraction!.failedPages.length)
        await writePdfCache(root, path, state)
        return state
      })
      const blocks = cache.batches.flatMap((b) => b.extraction?.blocks ?? []).map((block, order) => ({ ...block, order }))
      if (blocks.length) result.files.push({ material, hash, blocks })
      for (const batch of cache.batches) {
        if (batch.error) result.errors.push(`${material.file_name}: ${batch.error}`)
        if (batch.extraction?.failedPages.length) result.errors.push(`${material.file_name}: no se pudieron leer las páginas ${batch.extraction.failedPages.join(", ")}.`)
        if (batch.extraction?.blocks.some((b) => !b.region)) result.errors.push(`${material.file_name}: algunos bloques no tienen coordenadas fiables.`)
      }
    } catch (error) {
      signal.throwIfAborted()
      result.errors.push(`${material.file_name}: ${error instanceof Error ? error.message : "No se pudo preparar."}`)
    } finally {
      if (pendingHashes.has(hash)) finishedHashes.add(hash)
      if (finishedHashes.size === pendingHashes.size) progress(null)
    }
  }
  return result
}

type EvaluationCache = { version: string; query: string; hash: string; decisions: Record<string, PdfDecision> }
export async function searchTheoryPdfs(theory: PreparedTheory, query: string, signal: AbortSignal, publish: (results: PdfSearchResult[]) => void) {
  if (isManualTopicsQuery(query)) return {results:[] as PdfSearchResult[],errors:[] as string[]}
  const root = await pdfWorkspaceRoot(), normalized = normalizePdfQuery(query)
  if (!normalized || theory.week == null) return { results: [] as PdfSearchResult[], errors: [] as string[] }
  const queryHash = await pdfHash(new File([normalized], "query.txt"))
  const results: PdfSearchResult[] = [], errors: string[] = []
  for (const file of theory.files) {
    signal.throwIfAborted()
    const errorsBefore = errors.length, resultsBefore = results.length
    const candidates = buildPdfCandidates(file.blocks, normalized)
    const path = `manifests/subject-voice/pdf/${PDF_EXTRACTION_VERSION}/${file.hash}/${PDF_FILTER_VERSION}/${queryHash}.json`
    await inPdfCacheQueue(root, path, async () => {
      signal.throwIfAborted()
      const saved = await readPdfCache<EvaluationCache>(root, path)
      if (saved && (saved.version !== PDF_FILTER_VERSION || saved.hash !== file.hash || saved.query !== normalized || !saved.decisions)) throw new Error("La caché de búsqueda no es válida.")
      const cache: EvaluationCache = saved ?? { version: PDF_FILTER_VERSION, hash: file.hash, query: normalized, decisions: {} }
      for (const candidate of candidates) {
        signal.throwIfAborted()
        try {
          // Partial extraction may later gain neighboring blocks: never reuse a decision for a changed window.
          const candidateKey = await pdfHash(new File([JSON.stringify(candidate)], "candidate.txt"))
          let decision = cache.decisions[candidateKey]
          if (!decision) {
            decision = await responseJson<PdfDecision>(await fetch("/api/subject-voice/pdf-evaluate", {
              method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query: normalized, candidate }),
              signal: AbortSignal.timeout(55_000),
            }))
            if (decision.id !== candidate.id || typeof decision.accepted !== "boolean" || !Array.isArray(decision.blockIds) || !Array.isArray(decision.partialIds)
              || [...decision.blockIds, ...decision.partialIds].some((id) => !candidate.blocks.some((b) => b.id === id))) throw new Error("El filtro devolvió bloques desconocidos.")
            cache.decisions[candidateKey] = decision
            await writePdfCache(root, path, cache)
          }
          signal.throwIfAborted()
          if (decision.accepted) {
            const result = { id: `${file.material.id}:${file.hash}:${candidate.id}`, title: pdfResultTitle(candidate, decision),
              fileId: file.material.drive_file_id, fileName: file.material.file_name, hash: file.hash, week: theory.week!, query: normalized, candidate, decision }
            if ((await readPdfCorrection(result)).hidden) continue
            results.push(result)
            publish([...results])
          }
        } catch (error) {
          signal.throwIfAborted()
          errors.push(`${file.material.file_name}: ${error instanceof Error ? error.message : "No se pudo filtrar."}`)
          // Avoid repeatedly invoking an unavailable provider for every candidate in this PDF.
          break
        }
      }
    }).catch((error) => { signal.throwIfAborted(); errors.push(`${file.material.file_name}: ${error instanceof Error ? error.message : "No se pudo leer la búsqueda."}`) })
    if (errors.length === errorsBefore) {
      try { await savePdfSearch(file, normalized, results.slice(resultsBefore)) }
      catch (error) { signal.throwIfAborted(); errors.push(error instanceof Error ? error.message : "No se pudo guardar la búsqueda.") }
    }
  }
  return { results, errors }
}

export async function refinedPageWords(result: PdfSearchResult, page: number, signal: AbortSignal, progress: (text: string) => void) {
  const root = await pdfWorkspaceRoot()
  const path = `manifests/subject-voice/pdf/${PDF_EXTRACTION_VERSION}/${result.hash}/words-html-v2-${page}.json`
  return inPdfCacheQueue(root, path, async () => {
    signal.throwIfAborted()
    let state = await readPdfCache<{ token?: string; payload?: Record<string, unknown> }>(root, path) ?? {}
    if (state.payload) return state.payload
    progress(`Delimitando el fragmento de la página ${page}…`)
    const file = await getWorkspaceFile(result.fileId)
    const { loadPdfLib } = await import("./text-to-pdf")
    type Doc = { copyPages(source: Doc, pages: number[]): Promise<unknown[]>; addPage(page: unknown): void; save(): Promise<Uint8Array<ArrayBuffer>> }
    const { PDFDocument } = await loadPdfLib() as unknown as { PDFDocument: { load(bytes: ArrayBuffer): Promise<Doc>; create(): Promise<Doc> } }
    if (!state.token) {
      const source = await PDFDocument.load(await file.arrayBuffer()), document = await PDFDocument.create()
      for (const copied of await document.copyPages(source, [page - 1])) document.addPage(copied)
      const pageFile = new File([await document.save()], "fragmento.pdf", { type: "application/pdf" })
      if (pageFile.size > 3 * 1024 * 1024) throw new Error("La página supera el límite para delimitar por palabra.")
      state.token = await submit(pageFile, true)
      await writePdfCache(root, path, state)
    }
    try {
      state = { payload: await finishJob(state.token, signal) }
      await writePdfCache(root, path, state)
      return state.payload!
    } catch (error) {
      if (error instanceof Error && /venció|no pudo completar/.test(error.message)) { delete state.token; await writePdfCache(root, path, state) }
      throw error
    }
  })
}
