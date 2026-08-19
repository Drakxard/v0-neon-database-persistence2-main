"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"

import { useLocalWorkspace } from "@/components/local-workspace-provider"
import { useMaterialTags } from "@/hooks/use-material-tags"
import { readResponsePayload, requireOkJson, getErrorMessage } from "@/lib/client/api"
import { createObjectUrlForWorkspaceFile, getLocalMaterialById } from "@/lib/local-workspace-data"
import { uploadSubjectDayMaterial } from "@/lib/materials-client"
import { createPracticeAudioEntry } from "@/lib/practice-entry-client"
import { isLocalStorageMode } from "@/lib/storage-mode"
import { fetchSubjectShortcuts } from "@/lib/subject-shortcuts-client"
import { getSubjectShortcutUrl } from "@/lib/subject-shortcuts"
import { getSubjectById } from "@/lib/subjects"
import { normalizeTagName } from "@/lib/tag-utils"
import type { SubjectShortcutButton } from "@/lib/study-types"

type MaterialContext = {
  id: number
  subjectId: string
  subjectName: string
  sessionDate: string
  weekNumber: number
  weekdayIndex: number
  materialType?: "practice" | "theory"
  fileName: string
  workspaceFileId?: string | null
  sourceRevision?: string
  subjectActivationDate?: string
  subjectTargetWeekday?: number
  returnToken?: string
}

type DraftViewerContext = {
  subjectId: string
  subjectName: string
  sessionDate: string
  weekNumber: number
  weekdayIndex: number
  materialType: "practice" | "theory"
  returnToken?: string
}

type PairRole = "question" | "answer"

type AudioPosition = {
  entryId: number
  materialId: number
  pageNum: number
  xp: number
  yp: number
  transcriptText: string
  title: string
  audioUrl: string
  mimeType: string
  pairId: string | null
  pairRole: PairRole | null
}

type ReviewAudio = {
  blob: Blob
  url: string
  mimeType: string
}

type PairDraft = {
  pairId: string
  anchor: PendingAnchor
  slots: Record<PairRole, ReviewAudio | null>
}

type PendingAnchor = {
  pageNum: number
  xp: number
  yp: number
}

type FragmentUploadPayload = {
  blob: Blob
  fileName?: string | null
}

type ViewerMessage =
  | { type: "startAnchoredAudio"; payload?: PendingAnchor }
  | { type: "cancelAnchoredAudio" }
  | { type: "playAnchoredAudio"; entryId?: number }
  | { type: "deleteAnchoredAudio"; entryId?: number }
  | { type: "viewerRequestClose" }
  | { type: "viewerReady" }
  | { type: "viewerDocumentLoaded"; materialId?: number; fileName?: string; fingerprint?: string; numPages?: number }
  | { type: "viewerDocumentError"; materialId?: number; fileName?: string; error?: string }
  | { type: "viewerRequestMaterialTags" }
  | { type: "viewerRequestMaterialTag"; name?: string }
  | { type: "viewerUpdateMaterialTag"; tagId?: number; name?: string; color?: string }
  | { type: "viewerSelectMaterialTag"; tagId?: number }
  | { type: "viewerRequestMaterialTagRegions"; tagId?: number }
  | { type: "viewerSaveMaterialTagRegions"; tagId?: number; regions?: unknown[] }
  | { type: "uploadPracticeFragment"; payload?: FragmentUploadPayload }

type DeleteEntriesResponse = {
  ids?: number[]
}

const PAIR_ROLES: PairRole[] = ["question", "answer"]
const EMPTY_PRESENTATION_TAG_IDS: number[] = []

function getRecorderMimeType() {
  if (typeof window === "undefined" || typeof MediaRecorder === "undefined") return ""

  const mimeTypes = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"]
  return mimeTypes.find((mimeType) => MediaRecorder.isTypeSupported(mimeType)) || ""
}

function generatePairId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID()
  }
  return `pair-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

function getPairRoleLabel(role: PairRole) {
  return role === "question" ? "Pregunta" : "Respuesta"
}

function buildInitialPairDraft(anchor: PendingAnchor): PairDraft {
  return {
    pairId: generatePairId(),
    anchor,
    slots: {
      question: null,
      answer: null,
    },
  }
}

function buildPairAnchors(anchor: PendingAnchor) {
  const answerOffset = 0.04
  const nextAnswerXp = anchor.xp >= 0.94 ? Math.max(0, anchor.xp - answerOffset) : Math.min(1, anchor.xp + answerOffset)

  return {
    question: anchor,
    answer: {
      pageNum: anchor.pageNum,
      xp: nextAnswerXp,
      yp: anchor.yp,
    },
  } satisfies Record<PairRole, PendingAnchor>
}

function buildViewerSrc({
  material,
  draftContext,
  localWorkspaceMode,
  pendingMaterialId,
  mode,
  returnToken,
  presentationTagIds,
}: {
  material?: MaterialContext
  draftContext?: DraftViewerContext
  localWorkspaceMode?: boolean
  pendingMaterialId?: number
  mode?: "inline" | "standalone"
  returnToken?: string
  presentationTagIds?: number[]
}) {
  const params = new URLSearchParams()

  if (material) {
    params.set(
      "file",
      localWorkspaceMode
        ? ""
        : `/api/subject-day-materials/${material.id}/file`
    )
    params.set("fileName", material.fileName)
    params.set("key", `subject-day-material-${material.id}:${material.sourceRevision || material.workspaceFileId || "current"}`)
    params.set("materialId", String(material.id))
    params.set("subjectId", material.subjectId)
    params.set("subjectName", material.subjectName)
    params.set("sessionDate", material.sessionDate)
    params.set("weekNumber", String(material.weekNumber))
    params.set("weekdayIndex", String(material.weekdayIndex))
    if (material.subjectActivationDate) params.set("subjectActivationDate", material.subjectActivationDate)
    if (Number.isInteger(material.subjectTargetWeekday)) params.set("subjectTargetWeekday", String(material.subjectTargetWeekday))
    if (material.workspaceFileId) {
      params.set("workspaceFileId", material.workspaceFileId)
    }
  } else if (Number.isInteger(pendingMaterialId)) {
    params.set("materialId", String(pendingMaterialId))
    params.set("key", `subject-day-material-pending-${pendingMaterialId}`)
  }

  if (draftContext) {
    params.set("file", "")
    params.set("subjectId", draftContext.subjectId)
    params.set("subjectName", draftContext.subjectName)
    params.set("sessionDate", draftContext.sessionDate)
    params.set("weekNumber", String(draftContext.weekNumber))
    params.set("weekdayIndex", String(draftContext.weekdayIndex))
    params.set("materialType", draftContext.materialType)
    params.set("key", `practice-draft:${draftContext.subjectId}:${draftContext.sessionDate}`)
  }

  if (localWorkspaceMode) {
    params.set("localWorkspace", "1")
  }

  params.set("viewerMode", mode === "inline" ? "inline" : "standalone")

  if (returnToken) {
    params.set("returnToken", returnToken)
  }
  if (presentationTagIds?.length) {
    params.set("presentationTagIds", presentationTagIds.join(","))
  }

  return `/pdfjs/web/viewer.html?${params.toString()}#locale=es-AR`
}

function notifySubjectDayMaterialsRefresh(payload: { subjectId: string; sessionDate: string; weekNumber: number }) {
  if (typeof window === "undefined") return

  try {
    const channel = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel("subject-day-materials") : null
    channel?.postMessage(payload)
    channel?.close()
  } catch {}

  try {
    window.localStorage.setItem("subject-day-materials:refresh", JSON.stringify({ ...payload, timestamp: Date.now() }))
  } catch {}
}

export function PracticeViewerClient({
  material,
  draftContext,
  materialId,
  mode = "standalone",
  onRequestClose,
  returnToken,
  presentationTagIds = EMPTY_PRESENTATION_TAG_IDS,
}: {
  material?: MaterialContext
  draftContext?: DraftViewerContext
  materialId?: number
  mode?: "inline" | "standalone"
  onRequestClose?: () => void
  returnToken?: string
  presentationTagIds?: number[]
}) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const previewAudioRef = useRef<HTMLAudioElement | null>(null)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const mediaStreamRef = useRef<MediaStream | null>(null)
  const recordingChunksRef = useRef<Blob[]>([])
  const pairDraftRef = useRef<PairDraft | null>(null)
  const recordingRoleRef = useRef<PairRole | null>(null)

  const [positions, setPositions] = useState<AudioPosition[]>([])
  const [positionsError, setPositionsError] = useState("")
  const [isRecording, setIsRecording] = useState(false)
  const [isUploading, setIsUploading] = useState(false)
  const [recordingError, setRecordingError] = useState("")
  const [pairDraft, setPairDraft] = useState<PairDraft | null>(null)
  const [recordingTarget, setRecordingTarget] = useState<PairRole | null>(null)
  const [activeEntryId, setActiveEntryId] = useState<number | null>(null)
  const [previewPlayingRole, setPreviewPlayingRole] = useState<PairRole | null>(null)
  const [draggedRole, setDraggedRole] = useState<PairRole | null>(null)
  const [uploadFeedback, setUploadFeedback] = useState("")
  const [resolvedMaterial, setResolvedMaterial] = useState<MaterialContext | undefined>(material)
  const [viewerSourceError, setViewerSourceError] = useState("")
  const [viewerShortcuts, setViewerShortcuts] = useState<SubjectShortcutButton[]>([])
  const { rootHandle } = useLocalWorkspace()
  const playbackUrlCacheRef = useRef(new Map<string, string>())
  const isLocalMode = isLocalStorageMode()
  const viewerMaterialTags = useMaterialTags({
    subjectId: resolvedMaterial?.subjectId,
    weekNumber: resolvedMaterial?.weekNumber,
  })

  const viewerSrc = useMemo(
    () =>
      buildViewerSrc({
        material: resolvedMaterial,
        draftContext,
        localWorkspaceMode: isLocalMode,
        pendingMaterialId: Number.isInteger(materialId) ? materialId : undefined,
        mode,
        returnToken: resolvedMaterial?.returnToken || draftContext?.returnToken || returnToken,
        presentationTagIds,
      }),
    [draftContext, isLocalMode, materialId, mode, presentationTagIds, resolvedMaterial, returnToken]
  )
  const viewerIdentity = useMemo(() => {
    if (draftContext) return `draft:${draftContext.subjectId}:${draftContext.sessionDate}`
    if (!resolvedMaterial) return ""
    return [
      resolvedMaterial.id,
      resolvedMaterial.sourceRevision || resolvedMaterial.workspaceFileId || "current",
    ].join(":")
  }, [draftContext, resolvedMaterial])
  const canRenderViewer = Boolean(
    draftContext ||
    (
      resolvedMaterial &&
      !viewerSourceError &&
      (!isLocalMode || resolvedMaterial.workspaceFileId)
    )
  )
  const activeContext = resolvedMaterial ?? draftContext
  const hasMaterial = Boolean(resolvedMaterial)
  const isPairModalOpen = Boolean(resolvedMaterial && pairDraft)
  const isPairComplete = Boolean(pairDraft?.slots.question && pairDraft?.slots.answer)

  const postToViewer = useCallback((message: unknown) => {
    iframeRef.current?.contentWindow?.postMessage(message, window.location.origin)
  }, [])

  const publishViewerShortcuts = useCallback(() => {
    const sectionKey = activeContext ? `day:${activeContext.sessionDate}` : ""
    postToViewer({
      type: "viewerSubjectShortcuts",
      shortcuts: viewerShortcuts
        .map((shortcut) => ({ ...shortcut, effectiveUrl: getSubjectShortcutUrl(shortcut, sectionKey) }))
        .filter((shortcut) => Boolean(shortcut.effectiveUrl?.trim()))
        .map((shortcut) => ({ id: shortcut.id, label: shortcut.label, url: shortcut.effectiveUrl })),
    })
  }, [activeContext, postToViewer, viewerShortcuts])

  const publishViewerMaterialTags = useCallback(() => {
    if (!resolvedMaterial) return
    const assignedTagIds = new Set(viewerMaterialTags.workspace.assignments[String(resolvedMaterial.id)] ?? [])
    postToViewer({
      type: "viewerMaterialTags",
      tags: viewerMaterialTags.workspace.tags
        .map((tag) => ({ id: tag.id, name: tag.name, color: tag.color })),
      assignedTagIds: Array.from(assignedTagIds),
      regionCounts: viewerMaterialTags.workspace.regionCounts[String(resolvedMaterial.id)] ?? {},
    })
  }, [postToViewer, resolvedMaterial, viewerMaterialTags.workspace])

  const assignViewerMaterialTag = useCallback(async (name: string) => {
    if (!resolvedMaterial) {
      postToViewer({ type: "viewerMaterialTagResult", ok: false, error: "No hay un PDF activo para etiquetar." })
      return
    }

    const normalizedName = name.replace(/^#/, "").trim()
    if (!normalizedName) {
      postToViewer({ type: "viewerMaterialTagResult", ok: false, error: "Escribe un tag para asignarlo." })
      return
    }

    try {
      const existing = viewerMaterialTags.workspace.tags.find(
        (tag) => tag.normalizedName === normalizeTagName(normalizedName)
      )
      const tag = existing ?? (await viewerMaterialTags.createTag({ name: normalizedName })).tag
      const assignedTags = await viewerMaterialTags.assignTag(resolvedMaterial.id, tag.id)
      postToViewer({
        type: "viewerMaterialTagResult",
        ok: true,
        tags: assignedTags.map((assignedTag) => ({ id: assignedTag.id, name: assignedTag.name, color: assignedTag.color })),
      })
    } catch (error) {
      postToViewer({
        type: "viewerMaterialTagResult",
        ok: false,
        error: error instanceof Error ? error.message : "No se pudo asignar el tag.",
      })
    }
  }, [postToViewer, resolvedMaterial, viewerMaterialTags])

  const updateViewerMaterialTag = useCallback(async (tagId: number, name: string, color: string) => {
    const normalizedName = name.replace(/^#/, "").trim()
    if (!Number.isInteger(tagId) || !normalizedName) {
      postToViewer({ type: "viewerMaterialTagResult", ok: false, error: "El tag necesita un nombre." })
      return
    }

    try {
      await viewerMaterialTags.updateTag(tagId, { name: normalizedName, color })
      postToViewer({ type: "viewerMaterialTagResult", ok: true, updated: true })
      publishViewerMaterialTags()
    } catch (error) {
      postToViewer({
        type: "viewerMaterialTagResult",
        ok: false,
        error: error instanceof Error ? error.message : "No se pudo actualizar el tag.",
      })
    }
  }, [postToViewer, publishViewerMaterialTags, viewerMaterialTags])

  const loadViewerMaterialTagRegions = useCallback(async (tagId: number) => {
    if (!resolvedMaterial || !Number.isInteger(tagId)) return
    try {
      const response = await fetch(`/api/subject-day-materials/${resolvedMaterial.id}/tags/${tagId}/regions`, {
        cache: "no-store",
      })
      const regions = await requireOkJson<unknown[]>(response, "No se pudieron cargar las regiones.")
      postToViewer({ type: "viewerMaterialTagRegions", ok: true, tagId, regions })
    } catch (error) {
      postToViewer({
        type: "viewerMaterialTagRegions",
        ok: false,
        tagId,
        error: error instanceof Error ? error.message : "No se pudieron cargar las regiones.",
      })
    }
  }, [postToViewer, resolvedMaterial])

  const saveViewerMaterialTagRegions = useCallback(async (tagId: number, regions: unknown[]) => {
    if (!resolvedMaterial || !Number.isInteger(tagId)) return
    try {
      const response = await fetch(`/api/subject-day-materials/${resolvedMaterial.id}/tags/${tagId}/regions`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ regions: Array.isArray(regions) ? regions : [] }),
      })
      const saved = await requireOkJson<unknown[]>(response, "No se pudieron guardar las regiones.")
      await viewerMaterialTags.load()
      window.localStorage.setItem("material-tag-regions:refresh", JSON.stringify({
        materialId: resolvedMaterial.id,
        tagId,
        timestamp: Date.now(),
      }))
      postToViewer({ type: "viewerMaterialTagRegionsSaved", ok: true, tagId, regions: saved })
    } catch (error) {
      postToViewer({
        type: "viewerMaterialTagRegionsSaved",
        ok: false,
        tagId,
        error: error instanceof Error ? error.message : "No se pudieron guardar las regiones.",
      })
    }
  }, [postToViewer, resolvedMaterial, viewerMaterialTags])

  useEffect(() => {
    publishViewerMaterialTags()
  }, [publishViewerMaterialTags])

  useEffect(() => {
    publishViewerShortcuts()
  }, [publishViewerShortcuts])

  useEffect(() => {
    const subjectId = activeContext?.subjectId
    if (!subjectId) {
      setViewerShortcuts([])
      return
    }

    let cancelled = false
    void fetchSubjectShortcuts(subjectId)
      .then((shortcuts) => {
        if (!cancelled) setViewerShortcuts(shortcuts.buttons)
      })
      .catch((error) => {
        if (cancelled) return
        console.error("Failed to load viewer subject shortcuts:", error)
        setViewerShortcuts([])
      })

    return () => {
      cancelled = true
    }
  }, [activeContext?.subjectId])

  const disposeReviewAudio = useCallback((reviewAudio?: ReviewAudio | null) => {
    if (reviewAudio) {
      URL.revokeObjectURL(reviewAudio.url)
    }
  }, [])

  const replacePairDraft = useCallback((updater: (previous: PairDraft | null) => PairDraft | null) => {
    setPairDraft((previous) => {
      const next = updater(previous)
      pairDraftRef.current = next
      return next
    })
  }, [])

  const disposePairDraft = useCallback(
    (draft?: PairDraft | null) => {
      if (!draft) return
      disposeReviewAudio(draft.slots.question)
      disposeReviewAudio(draft.slots.answer)
    },
    [disposeReviewAudio]
  )

  const syncPositionsToViewer = useCallback(
    (nextPositions: AudioPosition[]) => {
      postToViewer({
        type: "anchoredAudioPositionsLoaded",
        positions: nextPositions,
      })
    },
    [postToViewer]
  )

  const loadPositions = useCallback(async () => {
    if (!resolvedMaterial) {
      setPositions([])
      syncPositionsToViewer([])
      return
    }

    try {
      setPositionsError("")
      const response = await fetch(`/api/subject-day-materials/${resolvedMaterial.id}/audio-positions`, { cache: "no-store" })
      const payload = await response.json()
      if (!response.ok) {
        throw new Error(getErrorMessage(payload, "No se pudieron cargar los audios anclados."))
      }
      const nextPositions = Array.isArray(payload) ? (payload as AudioPosition[]) : []
      setPositions(nextPositions)
      syncPositionsToViewer(nextPositions)
    } catch (error) {
      console.error("Failed to load anchored audio positions:", error)
      const message = error instanceof Error ? error.message : "No se pudieron cargar los audios anclados."
      setPositionsError(message)
      syncPositionsToViewer([])
    }
  }, [resolvedMaterial, syncPositionsToViewer])

  const resetPairState = useCallback(() => {
    setIsRecording(false)
    setIsUploading(false)
    setRecordingError("")
    setRecordingTarget(null)
    setPreviewPlayingRole(null)
    setDraggedRole(null)
    recordingRoleRef.current = null
    replacePairDraft((previous) => {
      disposePairDraft(previous)
      return null
    })
  }, [disposePairDraft, replacePairDraft])

  const stopMediaTracks = useCallback(() => {
    mediaRecorderRef.current = null
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((track) => track.stop())
      mediaStreamRef.current = null
    }
  }, [])

  const stopPreviewPlayback = useCallback(() => {
    const previewAudio = previewAudioRef.current
    if (!previewAudio) return
    previewAudio.pause()
    previewAudio.currentTime = 0
    setPreviewPlayingRole(null)
  }, [])

  const discardRecording = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.onstop = null
      mediaRecorderRef.current.stop()
    }
    stopMediaTracks()
    recordingChunksRef.current = []
    recordingRoleRef.current = null
    setIsRecording(false)
    setRecordingTarget(null)
  }, [stopMediaTracks])

  const closeRecorder = useCallback(() => {
    discardRecording()
    stopPreviewPlayback()
    resetPairState()
    postToViewer({ type: "cancelAnchoredAudio" })
  }, [discardRecording, postToViewer, resetPairState, stopPreviewPlayback])

  const startRecording = useCallback(
    async (role: PairRole) => {
      if (!pairDraftRef.current) return

      setRecordingError("")
      stopPreviewPlayback()

      try {
        if (typeof window === "undefined" || !navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
          throw new Error("Tu navegador no soporta grabacion de audio.")
        }

        if (mediaRecorderRef.current?.state && mediaRecorderRef.current.state !== "inactive") {
          return
        }

        const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
        const mimeType = getRecorderMimeType()
        const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream)

        mediaStreamRef.current = stream
        mediaRecorderRef.current = recorder
        recordingChunksRef.current = []
        recordingRoleRef.current = role
        setRecordingTarget(role)

        recorder.ondataavailable = (event) => {
          if (event.data.size > 0) {
            recordingChunksRef.current.push(event.data)
          }
        }

        recorder.onstop = () => {
          const stoppedRole = recordingRoleRef.current
          setIsRecording(false)
          setRecordingTarget(null)
          recordingRoleRef.current = null
          mediaRecorderRef.current = null
          const chunks = recordingChunksRef.current
          recordingChunksRef.current = []
          stopMediaTracks()
          if (!chunks.length || !stoppedRole) return

          const blob = new Blob(chunks, { type: recorder.mimeType || "audio/webm" })
          const nextReviewAudio: ReviewAudio = {
            blob,
            mimeType: blob.type || "audio/webm",
            url: URL.createObjectURL(blob),
          }

          replacePairDraft((previous) => {
            if (!previous) {
              disposeReviewAudio(nextReviewAudio)
              return previous
            }

            const previousSlot = previous.slots[stoppedRole]
            if (previousSlot) {
              disposeReviewAudio(previousSlot)
            }

            return {
              ...previous,
              slots: {
                ...previous.slots,
                [stoppedRole]: nextReviewAudio,
              },
            }
          })
        }

        recorder.start()
        setIsRecording(true)
      } catch (error) {
        stopMediaTracks()
        console.error("Failed to start anchored recording:", error)
        setRecordingError(error instanceof Error ? error.message : "No se pudo iniciar la grabacion.")
        setIsRecording(false)
        setRecordingTarget(null)
        recordingRoleRef.current = null
      }
    },
    [disposeReviewAudio, replacePairDraft, stopMediaTracks, stopPreviewPlayback]
  )

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      try {
        mediaRecorderRef.current.requestData?.()
      } catch {}
      mediaRecorderRef.current.stop()
    }
    stopMediaTracks()
  }, [stopMediaTracks])

  const playDraftAudio = useCallback(
    (role: PairRole) => {
      const nextAudio = pairDraftRef.current?.slots[role]
      const previewAudio = previewAudioRef.current
      if (!nextAudio || !previewAudio) return

      if (previewPlayingRole === role && !previewAudio.paused) {
        stopPreviewPlayback()
        return
      }

      previewAudio.src = nextAudio.url
      previewAudio.currentTime = 0
      void previewAudio
        .play()
        .then(() => {
          setPreviewPlayingRole(role)
        })
        .catch((error) => {
          console.error("Failed to play draft audio:", error)
          setRecordingError("No se pudo reproducir la previsualizacion.")
          setPreviewPlayingRole(null)
        })
    },
    [previewPlayingRole, stopPreviewPlayback]
  )

  const swapDraftRoles = useCallback(() => {
    replacePairDraft((previous) => {
      if (!previous) return previous
      return {
        ...previous,
        slots: {
          question: previous.slots.answer,
          answer: previous.slots.question,
        },
      }
    })
  }, [replacePairDraft])

  const confirmRecording = useCallback(async () => {
    if (!resolvedMaterial || !pairDraftRef.current) return

    const currentDraft = pairDraftRef.current
    if (!currentDraft.slots.question || !currentDraft.slots.answer) return

    setIsUploading(true)
    setRecordingError("")

    const createdEntryIds: number[] = []

    try {
      const anchors = buildPairAnchors(currentDraft.anchor)

      for (const role of PAIR_ROLES) {
        const slot = currentDraft.slots[role]
        if (!slot) {
          throw new Error("La dupla de audio debe incluir pregunta y respuesta.")
        }

        const createdEntry = await createPracticeAudioEntry<{ id: number }>({
          subjectId: resolvedMaterial.subjectId,
          subjectName: resolvedMaterial.subjectName,
          sessionDate: resolvedMaterial.sessionDate,
          weekNumber: resolvedMaterial.weekNumber,
          weekdayIndex: resolvedMaterial.weekdayIndex,
          materialId: resolvedMaterial.id,
          blob: slot.blob,
          mimeType: slot.mimeType,
          pairId: currentDraft.pairId,
          pairRole: role,
        })
        createdEntryIds.push(createdEntry.id)

        const anchor = anchors[role]
        const positionResponse = await fetch(`/api/subject-day-materials/${resolvedMaterial.id}/audio-positions`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            entryId: createdEntry.id,
            pageNum: anchor.pageNum,
            xp: anchor.xp,
            yp: anchor.yp,
          }),
        })
        await requireOkJson(positionResponse, "No se pudo guardar la posicion del audio.")
      }

      await loadPositions()
      closeRecorder()
    } catch (error) {
      console.error("Failed to confirm anchored audio pair:", error)
      const message = error instanceof Error ? error.message : "No se pudo confirmar la dupla de audio."
      setRecordingError(message)

      for (const createdEntryId of createdEntryIds) {
        try {
          await fetch(`/api/subject-day-entries/${createdEntryId}`, { method: "DELETE" })
        } catch (cleanupError) {
          console.error("Failed to cleanup partial audio pair:", cleanupError)
        }
      }

      await loadPositions()
    } finally {
      setIsUploading(false)
    }
  }, [closeRecorder, loadPositions, resolvedMaterial])

  const uploadPracticeFragment = useCallback(
    async (payload: FragmentUploadPayload) => {
      if (!activeContext) return
      const draftMaterialType = draftContext?.materialType ?? "practice"

      setUploadFeedback("Subiendo PDF fragmentado...")
      postToViewer({ type: "practiceFragmentUploadState", status: "uploading" })

      try {
        const rawFileName = typeof payload.fileName === "string" ? payload.fileName : ""
        const safeFileName = rawFileName.trim() || `fragmento-${activeContext.sessionDate}.pdf`
        const fileName = safeFileName.toLowerCase().endsWith(".pdf") ? safeFileName : `${safeFileName}.pdf`

        await uploadSubjectDayMaterial(
          {
            subjectId: activeContext.subjectId,
            subjectName: activeContext.subjectName,
            sessionDate: activeContext.sessionDate,
            weekNumber: activeContext.weekNumber,
            materialType: draftMaterialType,
          },
          payload.blob,
          fileName,
          "application/pdf"
        )

        setUploadFeedback(`PDF creado: ${fileName}`)
        postToViewer({
          type: "practiceFragmentUploadState",
          status: "success",
          fileName,
        })
        notifySubjectDayMaterialsRefresh({
          subjectId: activeContext.subjectId,
          sessionDate: activeContext.sessionDate,
          weekNumber: activeContext.weekNumber,
        })
      } catch (error) {
        const message = error instanceof Error ? error.message : "No se pudo subir el PDF fragmentado."
        console.error("Failed to upload practice fragment:", error)
        setUploadFeedback(message)
        postToViewer({
          type: "practiceFragmentUploadState",
          status: "error",
          error: message,
        })
      }
    },
    [activeContext, draftContext?.materialType, postToViewer]
  )

  const handleViewerMessage = useCallback(
    (event: MessageEvent<ViewerMessage>) => {
      if (event.origin !== window.location.origin || event.source !== iframeRef.current?.contentWindow || !event.data?.type) {
        return
      }

      if (event.data.type === "viewerReady") {
        syncPositionsToViewer(hasMaterial ? positions : [])
        publishViewerMaterialTags()
        publishViewerShortcuts()
        if (rootHandle) {
          postToViewer({ type: "viewerWorkspaceRootHandle", handle: rootHandle })
        }
        if (isLocalMode) {
          postToViewer({ type: "viewerWorkspaceMode", mode: "local" })
        }
        return
      }

      if (event.data.type === "viewerDocumentLoaded") {
        console.info("[practice-pdf] document loaded", {
          materialId: resolvedMaterial?.id ?? null,
          fileName: resolvedMaterial?.fileName || event.data.fileName || "",
          sourceRevision: resolvedMaterial?.sourceRevision || "",
          workspaceFileId: resolvedMaterial?.workspaceFileId || "",
          fingerprint: event.data.fingerprint || "",
          numPages: event.data.numPages ?? null,
        })
        return
      }

      if (event.data.type === "viewerDocumentError") {
        console.error("[practice-pdf] document error", {
          materialId: resolvedMaterial?.id ?? event.data.materialId ?? null,
          fileName: resolvedMaterial?.fileName || event.data.fileName || "",
          sourceRevision: resolvedMaterial?.sourceRevision || "",
          workspaceFileId: resolvedMaterial?.workspaceFileId || "",
          error: event.data.error || "",
        })
        return
      }

      if (event.data.type === "viewerRequestClose") {
        onRequestClose?.()
        return
      }

      if (event.data.type === "viewerRequestMaterialTags") {
        publishViewerMaterialTags()
        return
      }

      if (event.data.type === "viewerRequestMaterialTag") {
        void assignViewerMaterialTag(event.data.name || "")
        return
      }

      if (event.data.type === "viewerUpdateMaterialTag") {
        void updateViewerMaterialTag(
          Number(event.data.tagId),
          event.data.name || "",
          event.data.color || "#10b981"
        )
        return
      }

      if (event.data.type === "viewerSelectMaterialTag") {
        const tagId = Number(event.data.tagId)
        if (Number.isInteger(tagId)) {
          viewerMaterialTags.toggleSelectedTag(tagId)
        }
        return
      }

      if (event.data.type === "viewerRequestMaterialTagRegions") {
        void loadViewerMaterialTagRegions(Number(event.data.tagId))
        return
      }

      if (event.data.type === "viewerSaveMaterialTagRegions") {
        void saveViewerMaterialTagRegions(Number(event.data.tagId), event.data.regions ?? [])
        return
      }

      if (event.data.type === "uploadPracticeFragment") {
        const payload = event.data.payload
        if (!payload?.blob || !(payload.blob instanceof Blob)) return
        void uploadPracticeFragment(payload)
        return
      }

      if (!resolvedMaterial) {
        return
      }

      if (event.data.type === "cancelAnchoredAudio") {
        closeRecorder()
        return
      }

      if (event.data.type === "startAnchoredAudio") {
        if (!event.data.payload) return
        const nextDraft = buildInitialPairDraft(event.data.payload)
        setRecordingError("")
        stopPreviewPlayback()
        pairDraftRef.current = nextDraft
        replacePairDraft(() => nextDraft)
        void startRecording("question")
        return
      }

      if (event.data.type === "playAnchoredAudio") {
        const entryId = event.data.entryId
        if (!entryId) return
        const matching = positions.find((position) => position.entryId === entryId)
        if (!matching || !audioRef.current) return

        const audio = audioRef.current
        const currentUrl =
          isLocalMode && matching.audioUrl.startsWith("workspace://")
            ? playbackUrlCacheRef.current.get(matching.audioUrl) || ""
            : matching.audioUrl
        const isSame = activeEntryId === entryId && currentUrl.length > 0 && audio.src.endsWith(currentUrl)
        if (isSame && !audio.paused) {
          audio.pause()
          setActiveEntryId(null)
          postToViewer({ type: "anchoredAudioPlaybackState", entryId, playing: false })
          return
        }

        if (isLocalMode && matching.audioUrl.startsWith("workspace://")) {
          const cachedUrl = playbackUrlCacheRef.current.get(matching.audioUrl)
          if (cachedUrl) {
            audio.src = cachedUrl
            audio.currentTime = 0
            void audio.play()
              .then(() => {
                setActiveEntryId(entryId)
                postToViewer({ type: "anchoredAudioPlaybackState", entryId, playing: true })
              })
              .catch((error) => {
                console.error("Failed to play anchored audio:", error)
                setRecordingError("No se pudo reproducir el audio.")
                setActiveEntryId(null)
                postToViewer({ type: "anchoredAudioPlaybackState", entryId, playing: false })
              })
            return
          }

          void createObjectUrlForWorkspaceFile(matching.audioUrl)
            .then((nextUrl) => {
              playbackUrlCacheRef.current.set(matching.audioUrl, nextUrl)
              audio.src = nextUrl
              audio.currentTime = 0
              return audio.play()
            })
            .then(() => {
              setActiveEntryId(entryId)
              postToViewer({ type: "anchoredAudioPlaybackState", entryId, playing: true })
            })
            .catch((error) => {
              console.error("Failed to play anchored audio:", error)
              setRecordingError("No se pudo reproducir el audio.")
              setActiveEntryId(null)
              postToViewer({ type: "anchoredAudioPlaybackState", entryId, playing: false })
            })
          return
        }

        audio.src = matching.audioUrl
        audio.currentTime = 0
        void audio.play()
          .then(() => {
            setActiveEntryId(entryId)
            postToViewer({ type: "anchoredAudioPlaybackState", entryId, playing: true })
          })
          .catch((error) => {
            console.error("Failed to play anchored audio:", error)
            setRecordingError("No se pudo reproducir el audio.")
            setActiveEntryId(null)
            postToViewer({ type: "anchoredAudioPlaybackState", entryId, playing: false })
          })
        return
      }

      if (event.data.type === "deleteAnchoredAudio") {
        const entryId = Number(event.data.entryId)
        if (!Number.isInteger(entryId)) return

        void (async () => {
          try {
            const response = await fetch(`/api/subject-day-entries/${entryId}`, {
              method: "DELETE",
            })
            const payload = (await readResponsePayload(response)) as DeleteEntriesResponse | null
            if (!response.ok) {
              throw new Error(getErrorMessage(payload, "No se pudo borrar el audio."))
            }

            const deletedIds = Array.isArray(payload?.ids) && payload.ids.length > 0 ? payload.ids : [entryId]
            setPositions((previous) => {
              const deleted = new Set(deletedIds)
              const next = previous.filter((position) => !deleted.has(position.entryId))
              syncPositionsToViewer(next)
              return next
            })
            if (activeEntryId != null && deletedIds.includes(activeEntryId)) {
              audioRef.current?.pause()
              setActiveEntryId(null)
            }
            postToViewer({ type: "anchoredAudioDeleted", entryIds: deletedIds })
          } catch (error) {
            console.error("Failed to delete anchored audio:", error)
            const message = error instanceof Error ? error.message : "No se pudo borrar el audio."
            setRecordingError(message)
            postToViewer({ type: "anchoredAudioDeleteFailed", entryId, error: message })
            loadPositions()
          }
        })()
      }
    },
    [
      activeEntryId,
      assignViewerMaterialTag,
      closeRecorder,
      hasMaterial,
      isLocalMode,
      loadPositions,
      positions,
      postToViewer,
      publishViewerMaterialTags,
      publishViewerShortcuts,
      replacePairDraft,
      resolvedMaterial,
      startRecording,
      stopPreviewPlayback,
      syncPositionsToViewer,
      updateViewerMaterialTag,
      viewerMaterialTags,
      rootHandle,
      onRequestClose,
      uploadPracticeFragment,
    ]
  )

  useEffect(() => {
    setViewerSourceError("")
    setResolvedMaterial(material)
  }, [material])

  useEffect(() => {
    if (!isLocalMode || !rootHandle) return
    postToViewer({ type: "viewerWorkspaceRootHandle", handle: rootHandle })
    postToViewer({ type: "viewerWorkspaceMode", mode: "local" })
  }, [isLocalMode, postToViewer, rootHandle])

  useEffect(() => {
    if (!isLocalMode || material || !Number.isInteger(materialId) || !rootHandle) return

    let cancelled = false
    const resolvedMaterialId = materialId as number
    setViewerSourceError("")

    void (async () => {
      const localMaterial = await getLocalMaterialById(resolvedMaterialId)
      if (cancelled) return
      if (!localMaterial) {
        setViewerSourceError(`No se encontró el material local ${resolvedMaterialId}.`)
        return
      }

      setResolvedMaterial({
        id: localMaterial.id,
        subjectId: localMaterial.subject_id,
        subjectName: getSubjectById(localMaterial.subject_id)?.name.replace("\n", " ") || localMaterial.subject_id,
        sessionDate: localMaterial.session_date,
        weekNumber: localMaterial.week_number,
        weekdayIndex: localMaterial.weekday_index,
        materialType: localMaterial.material_type,
        fileName: localMaterial.file_name,
        workspaceFileId: localMaterial.drive_file_id,
        sourceRevision: `${localMaterial.drive_file_id}:${localMaterial.updated_at}`,
      })
    })().catch((error) => {
      if (cancelled) return
      const message = error instanceof Error ? error.message : `No se pudo resolver el material ${resolvedMaterialId}.`
      console.error("[practice-pdf] material resolution failed", { materialId: resolvedMaterialId, error })
      setViewerSourceError(message)
    })

    return () => {
      cancelled = true
    }
  }, [isLocalMode, material, materialId, rootHandle])

  useEffect(() => {
    void loadPositions()
  }, [loadPositions])

  useEffect(() => {
    window.addEventListener("message", handleViewerMessage as EventListener)
    return () => window.removeEventListener("message", handleViewerMessage as EventListener)
  }, [handleViewerMessage])

  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return

    const handleEnded = () => {
      if (activeEntryId != null) {
        postToViewer({ type: "anchoredAudioPlaybackState", entryId: activeEntryId, playing: false })
      }
      setActiveEntryId(null)
    }

    audio.addEventListener("ended", handleEnded)
    audio.addEventListener("pause", handleEnded)
    return () => {
      audio.removeEventListener("ended", handleEnded)
      audio.removeEventListener("pause", handleEnded)
    }
  }, [activeEntryId, postToViewer])

  useEffect(() => {
    const previewAudio = previewAudioRef.current
    if (!previewAudio) return

    const handlePreviewStop = () => setPreviewPlayingRole(null)
    previewAudio.addEventListener("ended", handlePreviewStop)
    previewAudio.addEventListener("pause", handlePreviewStop)
    return () => {
      previewAudio.removeEventListener("ended", handlePreviewStop)
      previewAudio.removeEventListener("pause", handlePreviewStop)
    }
  }, [])

  useEffect(() => {
    pairDraftRef.current = pairDraft
  }, [pairDraft])

  useEffect(() => {
    const handleGlobalKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.repeat || event.key !== "Escape") return

      if (isPairModalOpen) {
        event.preventDefault()
        closeRecorder()
        return
      }

      event.preventDefault()
      postToViewer({ type: "requestViewerEscape" })
    }

    window.addEventListener("keydown", handleGlobalKeyDown, true)
    return () => window.removeEventListener("keydown", handleGlobalKeyDown, true)
  }, [closeRecorder, isPairModalOpen, postToViewer])

  useEffect(() => {
    return () => {
      discardRecording()
      stopMediaTracks()
      stopPreviewPlayback()
      disposePairDraft(pairDraftRef.current)
      playbackUrlCacheRef.current.forEach((url) => URL.revokeObjectURL(url))
      playbackUrlCacheRef.current.clear()
    }
  }, [discardRecording, disposePairDraft, stopMediaTracks, stopPreviewPlayback])

  return (
    <main className="flex h-[100dvh] w-full flex-col overflow-hidden bg-[#d4d4d7] text-white">
      {canRenderViewer ? (
        <iframe
          key={viewerIdentity}
          ref={iframeRef}
          title={`Visor PDF: ${resolvedMaterial?.fileName || "fragmentador"}`}
          src={viewerSrc}
          className="block h-full w-full flex-1 border-0"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
          onLoad={() => {
            syncPositionsToViewer(hasMaterial ? positions : [])
            publishViewerShortcuts()
            if (rootHandle) {
              postToViewer({ type: "viewerWorkspaceRootHandle", handle: rootHandle })
            }
            if (isLocalMode) {
              postToViewer({ type: "viewerWorkspaceMode", mode: "local" })
            }
          }}
        />
      ) : (
        viewerSourceError ? (
          <div className="flex min-h-0 flex-1 items-center justify-center p-6">
            <div className="max-w-xl rounded-2xl border border-white/10 bg-white/5 px-5 py-4 text-center text-sm text-slate-300">
              {viewerSourceError}
            </div>
          </div>
        ) : (
          <div className="min-h-0 flex-1" aria-busy="true" aria-label="Cargando PDF" />
        )
      )}

      <audio ref={audioRef} hidden preload="none" />
      <audio ref={previewAudioRef} hidden preload="none" />

      {positionsError ? (
        <div className="fixed bottom-4 left-4 z-[1400] max-w-md rounded-xl border border-red-400/40 bg-red-950/90 px-4 py-3 text-sm text-red-100">
          {positionsError}
        </div>
      ) : null}

      {uploadFeedback ? (
        <div className="fixed bottom-4 right-4 z-[1400] max-w-md rounded-xl border border-white/10 bg-slate-900/95 px-4 py-3 text-sm text-slate-100 shadow-2xl">
          {uploadFeedback}
        </div>
      ) : null}

      {resolvedMaterial && isPairModalOpen && pairDraft ? (
        <div className="fixed inset-0 z-[1500] flex items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-xl rounded-3xl border border-amber-200/30 bg-[#efe2ad] p-6 text-slate-950 shadow-2xl">
            <div className="space-y-2">
              <p className="text-xs uppercase tracking-[0.24em] text-slate-700">Audio anclado</p>
              <h2 className="text-2xl font-semibold">Dupla pregunta / respuesta</h2>
              <p className="text-sm text-slate-700">
                {resolvedMaterial.subjectName} - {resolvedMaterial.sessionDate} - pagina {pairDraft.anchor.pageNum}
              </p>
              <p className="text-xs text-slate-600">
                El primer audio entra como pregunta. Puedes arrastrar los bloques para intercambiar roles.
              </p>
            </div>

            <div className="mt-6 space-y-4">
              {PAIR_ROLES.map((role) => {
                const slot = pairDraft.slots[role]
                const isThisRecording = isRecording && recordingTarget === role
                const isPlayingPreview = previewPlayingRole === role

                return (
                  <div
                    key={role}
                    draggable={!isRecording && !isUploading}
                    onDragStart={() => setDraggedRole(role)}
                    onDragOver={(event) => {
                      if (!draggedRole || draggedRole === role) return
                      event.preventDefault()
                    }}
                    onDrop={(event) => {
                      event.preventDefault()
                      if (!draggedRole || draggedRole === role) return
                      swapDraftRoles()
                      setDraggedRole(null)
                    }}
                    onDragEnd={() => setDraggedRole(null)}
                    className="rounded-2xl border border-slate-950/15 bg-white/30 p-4 shadow-sm"
                  >
                    <div className="flex items-center justify-between gap-4">
                      <div>
                        <p className="text-3xl font-semibold">{getPairRoleLabel(role)}</p>
                        <p className="text-xs uppercase tracking-[0.2em] text-slate-600">
                          {slot ? "Audio listo" : isThisRecording ? "Grabando..." : "Sin audio"}
                        </p>
                      </div>

                      <button
                        type="button"
                        onClick={() => void startRecording(role)}
                        disabled={isUploading || isRecording}
                        className="rounded-full border border-slate-950/30 bg-white/40 px-4 py-2 text-sm font-medium transition hover:bg-white/70 disabled:cursor-not-allowed disabled:opacity-50"
                        aria-label={`Regrabar ${getPairRoleLabel(role)}`}
                      >
                        Regrabar
                      </button>
                    </div>

                    <div className="mt-4 flex items-center gap-3">
                      <button
                        type="button"
                        onClick={() => playDraftAudio(role)}
                        disabled={!slot || isThisRecording}
                        className="grid h-11 w-11 place-items-center rounded-full border border-slate-950/30 bg-white/60 text-xl transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-50"
                        aria-label={slot ? `Reproducir ${getPairRoleLabel(role)}` : `${getPairRoleLabel(role)} vacia`}
                      >
                        {isPlayingPreview ? "Stop" : "Play"}
                      </button>

                      <div className="h-1 flex-1 rounded-full bg-slate-950/20">
                        <div className={`h-full rounded-full ${slot ? "w-full bg-slate-950/70" : "w-0 bg-slate-950/70"}`} />
                      </div>
                    </div>

                    <div className="mt-3 min-h-5 text-sm text-slate-700">
                      {isThisRecording
                        ? "Grabando en curso. Pulsa detener para conservar este audio."
                        : slot
                          ? "Listo para confirmar o regrabar."
                          : "Usa la flecha para grabar este slot."}
                    </div>
                  </div>
                )
              })}

              {recordingError ? <div className="text-sm text-red-700">{recordingError}</div> : null}
              {draggedRole ? <div className="text-xs text-slate-700">Suelta sobre el otro bloque para intercambiar roles.</div> : null}

              <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
                <button
                  type="button"
                  onClick={closeRecorder}
                  disabled={isUploading}
                  className="rounded-xl border border-slate-950/20 px-4 py-2 text-sm font-medium transition hover:bg-white/40 disabled:opacity-40"
                >
                  Cancelar
                </button>

                <div className="flex flex-wrap items-center gap-3">
                  {isRecording ? (
                    <button
                      type="button"
                      onClick={stopRecording}
                      disabled={isUploading}
                      className="rounded-xl bg-amber-500 px-4 py-2 text-sm font-medium text-black transition hover:bg-amber-400 disabled:opacity-40"
                    >
                      Detener
                    </button>
                  ) : null}

                  <button
                    type="button"
                    onClick={() => void confirmRecording()}
                    disabled={!isPairComplete || isUploading || isRecording}
                    className="rounded-xl bg-emerald-500 px-4 py-2 text-sm font-medium text-black transition hover:bg-emerald-400 disabled:opacity-40"
                  >
                    {isUploading ? "Guardando..." : "Confirmar"}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  )
}
