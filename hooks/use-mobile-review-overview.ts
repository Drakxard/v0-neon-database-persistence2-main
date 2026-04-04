"use client"

import { useEffect, useState } from "react"

import { fetchMobileReviewOverview } from "@/lib/mobile-review-client"
import type { VectorOverview } from "@/lib/study-types"

export function useMobileReviewOverview(params: {
  enabled: boolean
  weekNumber: number
  dateKey: string
  subjectId?: string | null
  logPrefix?: string
}) {
  const { enabled, weekNumber, dateKey, subjectId, logPrefix = "mobile-review-overview" } = params
  const [vectors, setVectors] = useState<VectorOverview[]>([])
  const [selectedVector, setSelectedVector] = useState<VectorOverview | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState("")

  useEffect(() => {
    if (!enabled) {
      setVectors([])
      setSelectedVector(null)
      setIsLoading(false)
      setError("")
      return
    }

    let cancelled = false
    setIsLoading(true)
    setError("")

    const loadOverview = async () => {
      try {
        const payload = await fetchMobileReviewOverview({
          weekNumber,
          date: dateKey,
          includeInactive: true,
        })
        if (cancelled) return
        const nextVectors = Array.isArray(payload.vectors) ? payload.vectors : []
        setVectors(nextVectors)
        setSelectedVector(subjectId ? nextVectors.find((vector) => vector.subjectId === subjectId) ?? null : null)
      } catch (loadError) {
        if (cancelled) return
        console.error(`Failed to load ${logPrefix}:`, loadError)
        setVectors([])
        setSelectedVector(null)
        setError(loadError instanceof Error ? loadError.message : "No se pudo cargar la cobertura semanal.")
      } finally {
        if (!cancelled) {
          setIsLoading(false)
        }
      }
    }

    void loadOverview()

    return () => {
      cancelled = true
    }
  }, [dateKey, enabled, logPrefix, subjectId, weekNumber])

  return {
    vectors,
    selectedVector,
    isLoading,
    error,
  }
}
