"use client"

import { useCallback, useEffect, useMemo, useState } from "react"

import { requireOkJson } from "@/lib/client/api"
import type { MaterialTagWorkspace, StudyTag } from "@/lib/study-types"
import type { TagFilterMode } from "@/lib/tag-utils"

const EMPTY_WORKSPACE: MaterialTagWorkspace = { tags: [], assignments: {}, regionCounts: {} }

export function useMaterialTags(scope: {
  subjectId?: string
  weekNumber?: number
  sessionDate?: string
}) {
  const [workspace, setWorkspace] = useState<MaterialTagWorkspace>(EMPTY_WORKSPACE)
  const [selectedTagIds, setSelectedTagIds] = useState<number[]>([])
  const [filterMode, setFilterMode] = useState<TagFilterMode>("or")
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState("")

  const storageKey = useMemo(
    () => scope.subjectId ? `study-tags:filters:v1:${scope.subjectId}` : "",
    [scope.subjectId]
  )

  const load = useCallback(async () => {
    if (!scope.subjectId) {
      setWorkspace(EMPTY_WORKSPACE)
      return
    }
    setIsLoading(true)
    setError("")
    try {
      const params = new URLSearchParams({ subjectId: scope.subjectId })
      if (Number.isInteger(scope.weekNumber)) params.set("weekNumber", String(scope.weekNumber))
      if (scope.sessionDate) params.set("sessionDate", scope.sessionDate)
      const response = await fetch(`/api/tags?${params.toString()}`, { cache: "no-store" })
      const payload = await requireOkJson<MaterialTagWorkspace>(response, "No se pudieron cargar los tags.")
      setWorkspace({
        tags: Array.isArray(payload.tags) ? payload.tags : [],
        assignments: payload.assignments && typeof payload.assignments === "object" ? payload.assignments : {},
        regionCounts: payload.regionCounts && typeof payload.regionCounts === "object" ? payload.regionCounts : {},
      })
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "No se pudieron cargar los tags.")
    } finally {
      setIsLoading(false)
    }
  }, [scope.sessionDate, scope.subjectId, scope.weekNumber])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    const refresh = (event: StorageEvent) => {
      if (event.key === "material-tag-regions:refresh") void load()
    }
    window.addEventListener("storage", refresh)
    return () => window.removeEventListener("storage", refresh)
  }, [load])

  useEffect(() => {
    if (!storageKey) return
    try {
      const raw = window.localStorage.getItem(storageKey)
      if (!raw) {
        setSelectedTagIds([])
        setFilterMode("or")
        return
      }
      const parsed = JSON.parse(raw) as { selectedTagIds?: unknown; filterMode?: unknown }
      setSelectedTagIds(
        Array.isArray(parsed.selectedTagIds)
          ? parsed.selectedTagIds.map(Number).filter(Number.isInteger)
          : []
      )
      setFilterMode(parsed.filterMode === "and" ? "and" : "or")
    } catch {
      setSelectedTagIds([])
      setFilterMode("or")
    }
  }, [storageKey])

  useEffect(() => {
    if (!storageKey) return

    const handleStorage = (event: StorageEvent) => {
      if (event.key !== storageKey) return
      try {
        const parsed = JSON.parse(event.newValue || "{}") as { selectedTagIds?: unknown; filterMode?: unknown }
        setSelectedTagIds(
          Array.isArray(parsed.selectedTagIds)
            ? parsed.selectedTagIds.map(Number).filter(Number.isInteger)
            : []
        )
        setFilterMode(parsed.filterMode === "and" ? "and" : "or")
      } catch {
        setSelectedTagIds([])
        setFilterMode("or")
      }
    }

    window.addEventListener("storage", handleStorage)
    return () => window.removeEventListener("storage", handleStorage)
  }, [storageKey])

  useEffect(() => {
    if (!storageKey) return
    window.localStorage.setItem(storageKey, JSON.stringify({ selectedTagIds, filterMode }))
  }, [filterMode, selectedTagIds, storageKey])

  useEffect(() => {
    const validIds = new Set(workspace.tags.map((tag) => tag.id))
    setSelectedTagIds((current) => current.filter((tagId) => validIds.has(tagId)))
  }, [workspace.tags])

  const request = useCallback(async <T,>(url: string, init: RequestInit, fallback: string) => {
    setError("")
    try {
      return await requireOkJson<T>(await fetch(url, init), fallback)
    } catch (requestError) {
      const message = requestError instanceof Error ? requestError.message : fallback
      setError(message)
      throw requestError
    }
  }, [])

  const createTag = useCallback(async (input: { name: string; color?: string; parentId?: number | null }) => {
    const result = await request<{ tag: StudyTag; created: boolean }>(
      "/api/tags",
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) },
      "No se pudo crear el tag."
    )
    await load()
    return result
  }, [load, request])

  const updateTag = useCallback(async (
    tagId: number,
    input: { name?: string; color?: string; parentId?: number | null }
  ) => {
    const result = await request<StudyTag>(
      `/api/tags/${tagId}`,
      { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) },
      "No se pudo actualizar el tag."
    )
    await load()
    return result
  }, [load, request])

  const mergeTags = useCallback(async (sourceTagId: number, targetTagId: number) => {
    const result = await request<StudyTag>(
      `/api/tags/${sourceTagId}/merge`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetTagId }),
      },
      "No se pudieron fusionar los tags."
    )
    setSelectedTagIds((current) => Array.from(new Set(
      current.map((tagId) => tagId === sourceTagId ? targetTagId : tagId)
    )))
    await load()
    return result
  }, [load, request])

  const deleteTag = useCallback(async (tagId: number, force = false) => {
    const result = await request<{ deleted: boolean; usageCount: number }>(
      `/api/tags/${tagId}${force ? "?force=1" : ""}`,
      { method: "DELETE" },
      "No se pudo eliminar el tag."
    )
    setSelectedTagIds((current) => current.filter((candidate) => candidate !== tagId))
    await load()
    return result
  }, [load, request])

  const assignTag = useCallback(async (materialId: number, tagId: number) => {
    const params = new URLSearchParams()
    if (scope.subjectId) params.set("subjectId", scope.subjectId)
    if (Number.isInteger(scope.weekNumber)) params.set("weekNumber", String(scope.weekNumber))
    const query = params.size > 0 ? `?${params.toString()}` : ""
    const tags = await request<StudyTag[]>(
      `/api/subject-day-materials/${materialId}/tags/${tagId}${query}`,
      { method: "PUT" },
      "No se pudo asignar el tag."
    )
    setWorkspace((current) => ({
      ...current,
      assignments: { ...current.assignments, [String(materialId)]: tags.map((tag) => tag.id) },
      tags: current.tags.map((tag) =>
        tag.id === tagId && !(current.assignments[String(materialId)] ?? []).includes(tagId)
          ? { ...tag, usageCount: tag.usageCount + 1 }
          : tag
      ),
    }))
    return tags
  }, [request, scope.subjectId, scope.weekNumber])

  const unassignTag = useCallback(async (materialId: number, tagId: number) => {
    const params = new URLSearchParams()
    if (scope.subjectId) params.set("subjectId", scope.subjectId)
    if (Number.isInteger(scope.weekNumber)) params.set("weekNumber", String(scope.weekNumber))
    const query = params.size > 0 ? `?${params.toString()}` : ""
    const tags = await request<StudyTag[]>(
      `/api/subject-day-materials/${materialId}/tags/${tagId}${query}`,
      { method: "DELETE" },
      "No se pudo quitar el tag."
    )
    setWorkspace((current) => ({
      ...current,
      assignments: { ...current.assignments, [String(materialId)]: tags.map((tag) => tag.id) },
      tags: current.tags.map((tag) =>
        tag.id === tagId && (current.assignments[String(materialId)] ?? []).includes(tagId)
          ? { ...tag, usageCount: Math.max(0, tag.usageCount - 1) }
          : tag
      ),
    }))
    return tags
  }, [request, scope.subjectId, scope.weekNumber])

  const toggleSelectedTag = useCallback((tagId: number) => {
    setSelectedTagIds((current) =>
      current.includes(tagId) ? current.filter((candidate) => candidate !== tagId) : [...current, tagId]
    )
  }, [])

  return {
    workspace,
    selectedTagIds,
    setSelectedTagIds,
    filterMode,
    setFilterMode,
    isLoading,
    error,
    setError,
    load,
    createTag,
    updateTag,
    mergeTags,
    deleteTag,
    assignTag,
    unassignTag,
    toggleSelectedTag,
  }
}

export type MaterialTagsController = ReturnType<typeof useMaterialTags>
