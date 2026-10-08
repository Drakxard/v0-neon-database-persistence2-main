"use client"

import { useEffect, useRef, useState } from "react"
import { latestTheoryMaterials, prepareTheoryPdfs, searchTheoryPdfs, theoryScopeSignature, type PreparedTheory, type PdfPreparationProgress } from "@/lib/client/subject-pdf-search"
import { completePdfQuery, continuesPdfQuery, filterPdfResults, normalizePdfQuery, type PdfSearchResult } from "@/lib/subject-pdf-search"
import { findSavedPdfSearch, loadSavedPdfSearches, type SavedPdfSearch } from "@/lib/client/subject-pdf-history"
import { isManualTopicsQuery } from "@/lib/subject-voice-search"

export function useSubjectPdfSearch(subjectId: string, query: string) {
  const [theory, setTheory] = useState<PreparedTheory | null>(null)
  const [results, setResults] = useState<PdfSearchResult[]>([])
  const [progress, setProgress] = useState<PdfPreparationProgress | null>(null)
  const [preparing, setPreparing] = useState(false)
  const [searching, setSearching] = useState(false)
  const [preparationErrors, setPreparationErrors] = useState<string[]>([])
  const [searchErrors, setSearchErrors] = useState<string[]>([])
  const [attempt, setAttempt] = useState(0)
  const signature = useRef("")
  const dismissed = useRef(new Set<string>())
  const broadSearch = useRef<{query: string; results: PdfSearchResult[]} | null>(null)
  const currentQuery = useRef(query)
  currentQuery.current = query
  const pending = useRef<{query: string; controller: AbortController; timer: number | null; results: PdfSearchResult[]} | null>(null)
  const history = useRef<SavedPdfSearch[]>([])
  useEffect(() => {
    const controller = new AbortController(), signal = controller.signal
    history.current = []
    broadSearch.current = null
    setTheory(null); setResults([]); setPreparationErrors([]); setProgress(null); setPreparing(true)
    void prepareTheoryPdfs(subjectId, signal, (value) => { if (!signal.aborted) setProgress(value) })
      .then(async (next) => {
        if (signal.aborted) return
        try {
          const savedHistory = await loadSavedPdfSearches(next, signal)
          if (!signal.aborted) history.current = savedHistory
        }
        catch (error) { if (!signal.aborted) next.errors.push(error instanceof Error ? error.message : "No se pudieron cargar las búsquedas guardadas.") }
        if (signal.aborted) return
        signature.current = next.signature
        const currentSignature = theoryScopeSignature(await latestTheoryMaterials(subjectId))
        if (signal.aborted) return
        setTheory(next); setPreparationErrors(next.errors); setProgress(null); setPreparing(false)
        if (currentSignature !== next.signature) setAttempt((n) => n + 1)
      }).catch((error) => {
        if (!signal.aborted) { setPreparationErrors([error instanceof Error ? error.message : "No se pudieron preparar los PDF."]); setProgress(null); setPreparing(false) }
      })
    return () => controller.abort()
  }, [subjectId, attempt])
  useEffect(() => {
    let disposed = false, checking = false
    const refresh = async () => {
      if (checking || document.visibilityState !== "visible" || !theory) return
      checking = true
      try {
        const latest = await latestTheoryMaterials(subjectId)
        const next = theoryScopeSignature(latest)
        if (!disposed && next !== signature.current) { signature.current = next; setAttempt((n) => n + 1) }
      } catch { /* Preparation reports folder errors; a passive check must not interrupt a search. */ }
      finally { checking = false }
    }
    const timer = window.setInterval(() => void refresh(), 30_000)
    window.addEventListener("focus", refresh)
    return () => { disposed = true; window.clearInterval(timer); window.removeEventListener("focus", refresh) }
  }, [subjectId, theory])
  useEffect(() => () => {
    pending.current?.controller.abort()
    if (pending.current?.timer != null) window.clearTimeout(pending.current.timer)
    pending.current = null
  }, [theory])
  useEffect(() => {
    const visible = (items: PdfSearchResult[]) => items.filter((item) => !dismissed.current.has(`${item.query}:${item.id}`))
    setSearchErrors([])
    if (theory && query.trim() && !isManualTopicsQuery(query) && pending.current && continuesPdfQuery(pending.current.query, query)) {
      setResults(visible(filterPdfResults(pending.current.results, query)))
      return
    }
    pending.current?.controller.abort()
    if (pending.current?.timer != null) window.clearTimeout(pending.current.timer)
    pending.current = null
    if (!query.trim() || !theory || isManualTopicsQuery(query)) { setResults([]); setSearching(false); return }
    if (broadSearch.current && continuesPdfQuery(broadSearch.current.query, query)) {
      setResults(visible(filterPdfResults(broadSearch.current.results, query)))
      setSearching(false)
      return
    }
    broadSearch.current = null
    setResults([])
    const searchQuery = completePdfQuery(theory.files.flatMap(file => file.blocks), query)
    const saved = findSavedPdfSearch(history.current, searchQuery)
    if (saved) {
      setResults(visible(saved.results))
      if (saved.previewOnly || saved.complete) {
        if (saved.complete && !saved.previewOnly) broadSearch.current = { query: normalizePdfQuery(query), results: saved.results }
        setSearching(false)
        return
      }
    }
    setSearching(true)
    const controller = new AbortController(), signal = controller.signal
    const request = { query: normalizePdfQuery(query), controller, timer: null as number | null, results: [] as PdfSearchResult[] }
    pending.current = request
    const publish = (items: PdfSearchResult[]) => {
      if (signal.aborted) return
      request.results = items
      setResults(visible(filterPdfResults(items, currentQuery.current)))
    }
    request.timer = window.setTimeout(() => {
      void searchTheoryPdfs(theory, searchQuery, signal, publish)
        .then(next => {
          if (signal.aborted) return
          if (!next.errors.length) {
            broadSearch.current = { query: request.query, results: next.results }
            const normalized = normalizePdfQuery(searchQuery)
            history.current = [...history.current.filter(item => item.query !== normalized), {query:normalized,results:next.results,complete:true}]
          }
          publish(next.results)
          pending.current = null
          setSearchErrors(next.errors); setSearching(false)
        })
        .catch(error => {
          if (signal.aborted) return
          pending.current = null
          setSearchErrors([error instanceof Error ? error.message : "No se pudo buscar en los PDF."]); setSearching(false)
        })
    }, 450)
  }, [query, theory])
  return { results, progress, preparing, searching, errors: [...preparationErrors, ...searchErrors], week: theory?.week,
    dismiss: (id: string, sourceQuery: string) => {
      dismissed.current.add(`${sourceQuery}:${id}`)
      history.current = history.current.map((item) => ({...item,results:item.results.filter((result) => result.id !== id || result.query !== sourceQuery)}))
      setResults((items) => items.filter((item) => item.id !== id))
    },
    correctionFailed: (error: unknown) => setSearchErrors((items) => [...items, error instanceof Error ? error.message : "No se pudo guardar la corrección."]),
    retry: () => setAttempt((n) => n + 1) }
}
