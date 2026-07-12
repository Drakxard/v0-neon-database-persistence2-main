"use client"

import { useEffect, useRef, useState } from "react"

import { fetchDailySession, saveDailySession } from "@/lib/daily-study-client"
import type { DailySessionRecord } from "@/lib/study-types"

type SubjectLike = {
  id: string
}

type SubjectVisibilityState<TSubject extends SubjectLike> = {
  activeSubjects: TSubject[]
  completedSubjects: TSubject[]
}

export function useDailySessionState<TSubject extends SubjectLike>(params: {
  currentDateKey: string
  tabId: string
  homeSelectedDate: Date
  visibleSubjects: TSubject[]
  activeSubjects: TSubject[]
  allCompletedSubjectIds: string[]
  showAllSubjectsForDay: boolean
  setShowAllSubjectsForDay: (value: boolean) => void
  setAllCompletedSubjectIds: (value: string[]) => void
  setActiveSubjects: (value: TSubject[]) => void
  setCompletedSubjects: (value: TSubject[]) => void
  getDisplaySubjectsForDate: (date: Date, showAllSubjects: boolean, subjects: TSubject[]) => TSubject[]
  normalizeSubjectsForDay: (
    completedIds: string[],
    date: Date,
    showAllSubjects: boolean,
    subjects: TSubject[]
  ) => SubjectVisibilityState<TSubject>
  onLoaded?: (session: DailySessionRecord | null) => void
}) {
  const {
    currentDateKey,
    tabId,
    homeSelectedDate,
    visibleSubjects,
    activeSubjects,
    allCompletedSubjectIds,
    showAllSubjectsForDay,
    setShowAllSubjectsForDay,
    setAllCompletedSubjectIds,
    setActiveSubjects,
    setCompletedSubjects,
    getDisplaySubjectsForDate,
    normalizeSubjectsForDay,
    onLoaded,
  } = params
  const [isLoading, setIsLoading] = useState(true)
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle")
  const readyToSync = useRef(false)

  useEffect(() => {
    let cancelled = false
    readyToSync.current = false

    const loadFromDatabase = async () => {
      try {
        const session = await fetchDailySession(currentDateKey, tabId)
        if (cancelled) return

        if (session && Array.isArray(session.active_subject_ids)) {
          const completedIds = Object.keys(session.completed_subjects || {})
          const nextShowAllSubjects = Boolean(session.show_all_subjects)
          const normalized = normalizeSubjectsForDay(completedIds, homeSelectedDate, nextShowAllSubjects, visibleSubjects)
          setShowAllSubjectsForDay(nextShowAllSubjects)
          setAllCompletedSubjectIds(completedIds)
          setActiveSubjects(normalized.activeSubjects)
          setCompletedSubjects(normalized.completedSubjects)
        } else {
          setShowAllSubjectsForDay(false)
          setAllCompletedSubjectIds([])
          setActiveSubjects(getDisplaySubjectsForDate(homeSelectedDate, false, visibleSubjects))
          setCompletedSubjects([])
        }

        onLoaded?.(session)
      } catch (error) {
        console.error("Failed to load from database:", error)
        if (cancelled) return
        setShowAllSubjectsForDay(false)
        setAllCompletedSubjectIds([])
        setActiveSubjects(getDisplaySubjectsForDate(homeSelectedDate, false, visibleSubjects))
        setCompletedSubjects([])
        onLoaded?.(null)
      } finally {
        if (cancelled) return
        setIsLoading(false)
        window.setTimeout(() => {
          readyToSync.current = true
        }, 0)
      }
    }

    setIsLoading(true)
    void loadFromDatabase()

    return () => {
      cancelled = true
    }
  }, [
    currentDateKey,
    tabId,
    getDisplaySubjectsForDate,
    homeSelectedDate,
    normalizeSubjectsForDay,
    onLoaded,
    setActiveSubjects,
    setAllCompletedSubjectIds,
    setCompletedSubjects,
    setShowAllSubjectsForDay,
    visibleSubjects,
  ])

  useEffect(() => {
    if (!readyToSync.current) return

    let cancelled = false

    const syncToDatabase = async () => {
      setSaveStatus("saving")
      try {
        const activeIds = activeSubjects.map((subject) => subject.id)
        const completedSubjects = allCompletedSubjectIds.reduce(
          (accumulator, subjectId) => {
            accumulator[subjectId] = true
            return accumulator
          },
          {} as Record<string, boolean>
        )

        await saveDailySession({
          date: currentDateKey,
          tabId,
          activeSubjectIds: activeIds,
          completedSubjects,
          showAllSubjects: showAllSubjectsForDay,
        })
        if (cancelled) return
        setSaveStatus("saved")
        window.setTimeout(() => setSaveStatus("idle"), 2000)
      } catch (error) {
        console.error("Failed to sync to database:", error)
        if (cancelled) return
        setSaveStatus("error")
        window.setTimeout(() => setSaveStatus("idle"), 3000)
      }
    }

    void syncToDatabase()

    return () => {
      cancelled = true
    }
  }, [activeSubjects, allCompletedSubjectIds, currentDateKey, showAllSubjectsForDay, tabId])

  return {
    isLoading,
    saveStatus,
  }
}
