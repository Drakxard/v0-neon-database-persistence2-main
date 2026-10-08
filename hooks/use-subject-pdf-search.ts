"use client"

import { useEffect, useRef, useState } from "react"
import { latestTheoryMaterials, prepareTheoryPdfs, searchTheoryPdfs, theoryScopeSignature, type PreparedTheory } from "@/lib/client/subject-pdf-search"
import type { PdfSearchResult } from "@/lib/subject-pdf-search"

export function useSubjectPdfSearch(subjectId: string, query: string) {
  const [theory, setTheory] = useState<PreparedTheory | null>(null)
  const [results, setResults] = useState<PdfSearchResult[]>([])
  const [progress, setProgress] = useState("")
  const [searching, setSearching] = useState(false)
  const [preparationErrors, setPreparationErrors] = useState<string[]>([])
  const [searchErrors, setSearchErrors] = useState<string[]>([])
  const [attempt, setAttempt] = useState(0)
  const signature = useRef("")
  useEffect(() => {
    const controller = new AbortController(), signal = controller.signal
    setTheory(null); setResults([]); setPreparationErrors([]); setProgress("Preparando PDF de teoría…")
    void prepareTheoryPdfs(subjectId, signal, (text) => { if (!signal.aborted) setProgress(text) })
      .then(async (next) => {
        if (signal.aborted) return
        signature.current = next.signature
        const currentSignature = theoryScopeSignature(await latestTheoryMaterials(subjectId))
        if (signal.aborted) return
        setTheory(next); setPreparationErrors(next.errors); setProgress("")
        if (currentSignature !== next.signature) setAttempt((n) => n + 1)
      }).catch((error) => {
        if (!signal.aborted) { setPreparationErrors([error instanceof Error ? error.message : "No se pudieron preparar los PDF."]); setProgress("") }
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
    if (!query.trim() || !theory) { setSearching(false); return () => controller.abort() }
    setSearching(true)
    const timer = window.setTimeout(() => {
      void searchTheoryPdfs(theory, query, signal, (next) => { if (!signal.aborted) setResults(next) })
        .then((next) => { if (!signal.aborted) { setResults(next.results); setSearchErrors(next.errors); setSearching(false) } })
        .catch((error) => { if (!signal.aborted) { setSearchErrors([error instanceof Error ? error.message : "No se pudo buscar en los PDF."]); setSearching(false) } })
    }, 450)
    return () => { controller.abort(); window.clearTimeout(timer) }
  }, [query, theory])
  return { results, progress, searching, errors: [...preparationErrors, ...searchErrors], week: theory?.week,
    retry: () => setAttempt((n) => n + 1) }
}
