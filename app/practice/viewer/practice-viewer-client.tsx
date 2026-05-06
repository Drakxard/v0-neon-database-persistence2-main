"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"

import { useLocalWorkspace } from "@/components/local-workspace-provider"
import { readResponsePayload, requireOkJson, getErrorMessage } from "@/lib/client/api"
import { uploadSubjectDayMaterial } from "@/lib/materials-client"
import { createPracticeAudioEntry } from "@/lib/practice-entry-client"

type MaterialContext = {
  id: number
  subjectId: string
  subjectName: string
  sessionDate: string
  weekNumber: number
  weekdayIndex: number
  fileName: string
}

type DraftViewerContext = {
  subjectId: string
  subjectName: string
  sessionDate: string
  weekNumber: number
  weekdayIndex: number
  materialType: "practice" | "theory"
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
  | { type: "viewerReady" }
  | { type: "uploadPracticeFragment"; payload?: FragmentUploadPayload }

type DeleteEntriesResponse = {
  ids?: number[]
}

const PAIR_ROLES: PairRole[] = ["question", "answer"]

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
}: {
  material?: MaterialContext
  draftContext?: DraftViewerContext
}) {
  const params = new URLSearchParams()

  if (material) {
    params.set("url", `/api/subject-day-materials/${material.id}/file`)
    params.set("name", material.fileName)
    params.set("key", `subject-day-material-${material.id}`)
    params.set("materialId", String(material.id))
    params.set("subjectId", material.subjectId)
    params.set("subjectName", material.subjectName)
    params.set("sessionDate", material.sessionDate)
    params.set("weekNumber", String(material.weekNumber))
    params.set("weekdayIndex", String(material.weekdayIndex))
  }

  if (draftContext) {
    params.set("draftUpload", "1")
    params.set("subjectId", draftContext.subjectId)
    params.set("subjectName", draftContext.subjectName)
    params.set("sessionDate", draftContext.sessionDate)
    params.set("weekNumber", String(draftContext.weekNumber))
    params.set("weekdayIndex", String(draftContext.weekdayIndex))
    params.set("materialType", draftContext.materialType)
  }

  return `/visor/index.html?${params.toString()}`
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
}: {
  material?: MaterialContext
  draftContext?: DraftViewerContext
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
  const { rootHandle } = useLocalWorkspace()

  const viewerSrc = useMemo(() => buildViewerSrc({ material, draftContext }), [draftContext, material])
  const activeContext = material ?? draftContext
  const hasMaterial = Boolean(material)
  const isPairModalOpen = Boolean(material && pairDraft)
  const isPairComplete = Boolean(pairDraft?.slots.question && pairDraft?.slots.answer)

  const postToViewer = useCallback((message: unknown) => {
    iframeRef.current?.contentWindow?.postMessage(message, window.location.origin)
  }, [])

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
    if (!material) {
      setPositions([])
      syncPositionsToViewer([])
      return
    }

    try {
      setPositionsError("")
      const response = await fetch(`/api/subject-day-materials/${material.id}/audio-positions`, { cache: "no-store" })
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
  }, [material, syncPositionsToViewer])

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
    if (!material || !pairDraftRef.current) return

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
          subjectId: material.subjectId,
          subjectName: material.subjectName,
          sessionDate: material.sessionDate,
          weekNumber: material.weekNumber,
          weekdayIndex: material.weekdayIndex,
          materialId: material.id,
          blob: slot.blob,
          mimeType: slot.mimeType,
          pairId: currentDraft.pairId,
          pairRole: role,
        })
        createdEntryIds.push(createdEntry.id)

        const anchor = anchors[role]
        const positionResponse = await fetch(`/api/subject-day-materials/${material.id}/audio-positions`, {
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
  }, [closeRecorder, loadPositions, material])

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
        if (rootHandle) {
          postToViewer({ type: "viewerWorkspaceRootHandle", handle: rootHandle })
        }
        return
      }

      if (event.data.type === "uploadPracticeFragment") {
        const payload = event.data.payload
        if (!payload?.blob || !(payload.blob instanceof Blob)) return
        void uploadPracticeFragment(payload)
        return
      }

      if (!material) {
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
        const isSame = activeEntryId === entryId && audio.src.endsWith(matching.audioUrl)
        if (isSame && !audio.paused) {
          audio.pause()
          setActiveEntryId(null)
          postToViewer({ type: "anchoredAudioPlaybackState", entryId, playing: false })
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
      closeRecorder,
      hasMaterial,
      loadPositions,
      material,
      positions,
      postToViewer,
      replacePairDraft,
      startRecording,
      stopPreviewPlayback,
      syncPositionsToViewer,
      rootHandle,
      uploadPracticeFragment,
    ]
  )

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
    return () => {
      discardRecording()
      stopMediaTracks()
      stopPreviewPlayback()
      disposePairDraft(pairDraftRef.current)
    }
  }, [discardRecording, disposePairDraft, stopMediaTracks, stopPreviewPlayback])

  return (
    <main className="min-h-screen bg-slate-950 text-white">
      <iframe
        ref={iframeRef}
        title={`Visor PDF: ${material?.fileName || "fragmentador"}`}
        src={viewerSrc}
        className="h-screen w-full border-0"
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
        allowFullScreen
        onLoad={() => {
          syncPositionsToViewer(hasMaterial ? positions : [])
          if (rootHandle) {
            postToViewer({ type: "viewerWorkspaceRootHandle", handle: rootHandle })
          }
        }}
      />

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

      {material && isPairModalOpen && pairDraft ? (
        <div className="fixed inset-0 z-[1500] flex items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-xl rounded-3xl border border-amber-200/30 bg-[#efe2ad] p-6 text-slate-950 shadow-2xl">
            <div className="space-y-2">
              <p className="text-xs uppercase tracking-[0.24em] text-slate-700">Audio anclado</p>
              <h2 className="text-2xl font-semibold">Dupla pregunta / respuesta</h2>
              <p className="text-sm text-slate-700">
                {material.subjectName} - {material.sessionDate} - pagina {pairDraft.anchor.pageNum}
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
