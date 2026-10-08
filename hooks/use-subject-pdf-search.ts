"use client"

import { useEffect, useRef, useState } from "react"
import { latestTheoryMaterials, prepareTheoryPdfs, searchTheoryPdfs, theoryScopeSignature, type PreparedTheory, type PdfPreparationProgress } from "@/lib/client/subject-pdf-search"
import { completePdfQuery, normalizePdfQuery, type PdfSearchResult } from "@/lib/subject-pdf-search"
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
  const history = useRef<SavedPdfSearch[]>([])
  useEffect(() => {
    const controller = new AbortController(), signal = controller.signal
    history.current = []
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
  useEffect(() => {
    const controller = new AbortController(), signal = controller.signal
    setResults([]); setSearchErrors([])
    if (!query.trim() || !theory || isManualTopicsQuery(query)) { setSearching(false); return () => controller.abort() }
    const visible = (items: PdfSearchResult[]) => items.filter((item) => !dismissed.current.has(`${item.query}:${item.id}`))
    const searchQuery = completePdfQuery(theory.files.flatMap(file => file.blocks), query)
    const saved = findSavedPdfSearch(history.current, searchQuery)
    if (saved) {
      setResults(visible(saved.results))
      // A prefix previews previously filtered content; it does not send a partial word to Clef.
      if (saved.previewOnly || saved.complete) { setSearching(false); return () => controller.abort() }
    }
    setSearching(true)
    const timer = window.setTimeout(() => {
      void searchTheoryPdfs(theory, searchQuery, signal, (next) => { if (!signal.aborted) setResults(visible(next)) })
        .then((next) => { if (!signal.aborted) {
          if (!next.errors.length) {
            const normalized = normalizePdfQuery(searchQuery)
            history.current = [...history.current.filter((item) => item.query !== normalized), {query:normalized,results:next.results,complete:true}]
          }
          setResults(visible(next.results)); setSearchErrors(next.errors); setSearching(false)
        } })
        .catch((error) => { if (!signal.aborted) { setSearchErrors([error instanceof Error ? error.message : "No se pudo buscar en los PDF."]); setSearching(false) } })
    }, 450)
    return () => { controller.abort(); window.clearTimeout(timer) }
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
