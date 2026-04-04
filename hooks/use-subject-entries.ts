"use client"

import { useCallback, useRef, useState } from "react"

import { fetchFeaturedReviewEntries, fetchPracticeWeekEntries } from "@/lib/entries-client"
import { fetchSubjectShortcuts, getEmptySubjectShortcuts, updateSubjectShortcut } from "@/lib/subject-shortcuts-client"
import type { SubjectDayEntry, SubjectShortcutKey, SubjectShortcuts } from "@/lib/study-types"
import { SUBJECT_ID_TO_INDEX } from "@/lib/subjects"

export function useSubjectEntries() {
  const [reviewEntries, setReviewEntries] = useState<SubjectDayEntry[]>([])
  const [isLoadingReview, setIsLoadingReview] = useState(false)
  const [reviewError, setReviewError] = useState("")
  const [practiceEntries, setPracticeEntries] = useState<SubjectDayEntry[]>([])
  const [practiceLoadError, setPracticeLoadError] = useState("")
  const [isLoadingPractice, setIsLoadingPractice] = useState(false)
  const [subjectShortcuts, setSubjectShortcuts] = useState<SubjectShortcuts>(() => getEmptySubjectShortcuts())
  const [isSubjectShortcutsLoading, setIsSubjectShortcutsLoading] = useState(false)
  const subjectShortcutsRequestIdRef = useRef(0)

  const loadReviewEntries = useCallback(async (subjectId: string) => {
    setIsLoadingReview(true)
    setReviewError("")

    try {
      setReviewEntries(await fetchFeaturedReviewEntries(subjectId))
    } catch (error) {
      console.error("Failed to load review entries:", error)
      setReviewEntries([])
      setReviewError(error instanceof Error ? error.message : "No se pudieron cargar los destacados.")
    } finally {
      setIsLoadingReview(false)
    }
  }, [])

  const loadPracticeEntries = useCallback(async (params: {
    subjectId: string
    weekNumber: string
    applyFilters: (entries: SubjectDayEntry[]) => SubjectDayEntry[]
    onResolvedSubject?: (subjectIndex: number) => void
    onStarted?: () => void
    onFailedValidation?: () => void
  }) => {
    const subjectIndex = SUBJECT_ID_TO_INDEX[params.subjectId]
    if (subjectIndex === undefined) {
      setPracticeEntries([])
      setPracticeLoadError("La materia seleccionada no es valida.")
      params.onFailedValidation?.()
      return []
    }

    const parsedWeekNumber = Number.parseInt(params.weekNumber, 10)
    if (Number.isNaN(parsedWeekNumber) || parsedWeekNumber < 0) {
      setPracticeEntries([])
      setPracticeLoadError("La semana seleccionada no es valida.")
      params.onFailedValidation?.()
      return []
    }

    params.onStarted?.()
    params.onResolvedSubject?.(subjectIndex)
    setIsLoadingPractice(true)
    setPracticeLoadError("")

    try {
      const controller = new AbortController()
      const timeoutId = window.setTimeout(() => controller.abort(), 10000)
      let normalizedEntries: SubjectDayEntry[]

      try {
        normalizedEntries = await fetchPracticeWeekEntries(params.subjectId, parsedWeekNumber, controller.signal)
      } finally {
        window.clearTimeout(timeoutId)
      }

      setPracticeEntries(normalizedEntries)
      return params.applyFilters(normalizedEntries)
    } catch (error) {
      console.error("Failed to load practice entries:", error)
      setPracticeEntries([])
      setPracticeLoadError(
        error instanceof Error ? error.message : "No se pudieron cargar las dudas de practica."
      )
      return []
    } finally {
      setIsLoadingPractice(false)
    }
  }, [])

  const loadSubjectShortcuts = useCallback(async (subjectId: string) => {
    const requestId = subjectShortcutsRequestIdRef.current + 1
    subjectShortcutsRequestIdRef.current = requestId
    setIsSubjectShortcutsLoading(true)

    try {
      const payload = await fetchSubjectShortcuts(subjectId)
      if (requestId !== subjectShortcutsRequestIdRef.current) return payload
      setSubjectShortcuts(payload)
      return payload
    } catch (error) {
      console.error("Failed to load subject shortcuts:", error)
      if (requestId !== subjectShortcutsRequestIdRef.current) {
        return getEmptySubjectShortcuts(subjectId)
      }
      const emptyState = getEmptySubjectShortcuts(subjectId)
      setSubjectShortcuts(emptyState)
      throw error
    } finally {
      if (requestId === subjectShortcutsRequestIdRef.current) {
        setIsSubjectShortcutsLoading(false)
      }
    }
  }, [])

  const saveSubjectShortcut = useCallback(async (input: {
    subjectId: string
    shortcutKey: SubjectShortcutKey
    url: string
  }) => {
    const payload = await updateSubjectShortcut(input)
    setSubjectShortcuts(payload)
    return payload
  }, [])

  return {
    reviewEntries,
    isLoadingReview,
    reviewError,
    practiceEntries,
    isLoadingPractice,
    practiceLoadError,
    subjectShortcuts,
    isSubjectShortcutsLoading,
    setReviewEntries,
    setReviewError,
    setPracticeLoadError,
    setPracticeEntries,
    setSubjectShortcuts,
    loadReviewEntries,
    loadPracticeEntries,
    loadSubjectShortcuts,
    saveSubjectShortcut,
  }
}
