"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"

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
  materialType: "practice"
}

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
}

type ReviewAudio = {
  blob: Blob
  url: string
  mimeType: string
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

function getRecorderMimeType() {
  if (typeof window === "undefined" || typeof MediaRecorder === "undefined") return ""

  const mimeTypes = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"]
  return mimeTypes.find((mimeType) => MediaRecorder.isTypeSupported(mimeType)) || ""
}

function getErrorMessage(payload: unknown, fallback: string) {
  if (payload && typeof payload === "object" && "error" in payload && typeof payload.error === "string") {
    return payload.error
  }
  return fallback
}

async function readResponsePayload(response: Response) {
  const contentType = response.headers.get("content-type") || ""

  if (contentType.includes("application/json")) {
    return response.json()
  }

  const text = await response.text()
  if (!text) return null

  try {
    return JSON.parse(text)
  } catch {
    return { error: text }
  }
}

async function requireOkJson(response: Response, fallback: string) {
  const payload = await readResponsePayload(response)
  if (!response.ok) {
    throw new Error(getErrorMessage(payload, fallback))
  }
  return payload
}

type DriveUploadSessionResponse = {
  uploadUrl: string
  method?: string
  headers?: Record<string, string>
  fileName: string
  driveFileId?: string
}

async function uploadBlobToDrive(session: DriveUploadSessionResponse, blob: Blob) {
  const response = await fetch(session.uploadUrl, {
    method: session.method || "PUT",
    headers: session.headers,
    body: blob,
  })

  const payload = await readResponsePayload(response)
  if (!response.ok) {
    throw new Error(getErrorMessage(payload, "No se pudo subir el archivo al storage."))
  }

  const driveFileId =
    (payload && typeof payload === "object" && "id" in payload && typeof payload.id === "string" ? payload.id : "") ||
    session.driveFileId ||
    ""

  if (!driveFileId) {
    throw new Error("El storage no devolvio el identificador del archivo subido.")
  }

  return {
    driveFileId,
    payload,
  }
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

function notifyPracticeMaterialsRefresh(payload: { subjectId: string; sessionDate: string; weekNumber: number }) {
  if (typeof window === "undefined") return

  try {
    const channel = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel("practice-materials") : null
    channel?.postMessage(payload)
    channel?.close()
  } catch {}

  try {
    window.localStorage.setItem("practice-materials:refresh", JSON.stringify({ ...payload, timestamp: Date.now() }))
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
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const mediaStreamRef = useRef<MediaStream | null>(null)
  const recordingChunksRef = useRef<Blob[]>([])
  const reviewAudioRef = useRef<ReviewAudio | null>(null)

  const [positions, setPositions] = useState<AudioPosition[]>([])
  const [positionsError, setPositionsError] = useState("")
  const [isRecorderOpen, setIsRecorderOpen] = useState(false)
  const [isRecording, setIsRecording] = useState(false)
  const [isUploading, setIsUploading] = useState(false)
  const [recordingError, setRecordingError] = useState("")
  const [reviewAudio, setReviewAudio] = useState<ReviewAudio | null>(null)
  const [pendingAnchor, setPendingAnchor] = useState<PendingAnchor | null>(null)
  const [activeEntryId, setActiveEntryId] = useState<number | null>(null)
  const [uploadFeedback, setUploadFeedback] = useState("")

  const viewerSrc = useMemo(() => buildViewerSrc({ material, draftContext }), [draftContext, material])
  const activeContext = material ?? draftContext
  const hasMaterial = Boolean(material)

  const postToViewer = useCallback((message: unknown) => {
    iframeRef.current?.contentWindow?.postMessage(message, window.location.origin)
  }, [])

  const disposeReviewAudio = useCallback((nextReviewAudio?: ReviewAudio | null) => {
    const currentReviewAudio = nextReviewAudio ?? reviewAudioRef.current
    if (currentReviewAudio) {
      URL.revokeObjectURL(currentReviewAudio.url)
    }
    if (!nextReviewAudio) {
      reviewAudioRef.current = null
    }
  }, [])

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

  const resetRecorderState = useCallback(() => {
    setIsRecording(false)
    setIsUploading(false)
    setRecordingError("")
    setPendingAnchor(null)
    setIsRecorderOpen(false)
    disposeReviewAudio()
    setReviewAudio(null)
  }, [disposeReviewAudio])

  const stopMediaTracks = useCallback(() => {
    mediaRecorderRef.current = null
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((track) => track.stop())
      mediaStreamRef.current = null
    }
  }, [])

  const stopAndDiscardRecording = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.onstop = null
      mediaRecorderRef.current.stop()
    }
    stopMediaTracks()
    recordingChunksRef.current = []
    setIsRecording(false)
  }, [stopMediaTracks])

  const closeRecorder = useCallback(() => {
    stopAndDiscardRecording()
    resetRecorderState()
    postToViewer({ type: "cancelAnchoredAudio" })
  }, [postToViewer, resetRecorderState, stopAndDiscardRecording])

  const startRecording = useCallback(async () => {
    setRecordingError("")
    disposeReviewAudio()
    setReviewAudio(null)

    try {
      if (typeof window === "undefined" || !navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
        throw new Error("Tu navegador no soporta grabacion de audio.")
      }

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const mimeType = getRecorderMimeType()
      const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream)

      mediaStreamRef.current = stream
      mediaRecorderRef.current = recorder
      recordingChunksRef.current = []

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          recordingChunksRef.current.push(event.data)
        }
      }

      recorder.onstop = () => {
        setIsRecording(false)
        mediaRecorderRef.current = null
        const chunks = recordingChunksRef.current
        recordingChunksRef.current = []
        stopMediaTracks()
        if (!chunks.length) return

        const blob = new Blob(chunks, { type: recorder.mimeType || "audio/webm" })
        const nextReviewAudio = {
          blob,
          mimeType: blob.type || "audio/webm",
          url: URL.createObjectURL(blob),
        }
        reviewAudioRef.current = nextReviewAudio
        setReviewAudio(nextReviewAudio)
      }

      recorder.start()
      setIsRecording(true)
    } catch (error) {
      stopMediaTracks()
      console.error("Failed to start anchored recording:", error)
      setRecordingError(error instanceof Error ? error.message : "No se pudo iniciar la grabacion.")
      setIsRecording(false)
    }
  }, [disposeReviewAudio, stopMediaTracks])

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      try {
        mediaRecorderRef.current.requestData?.()
      } catch {}
      mediaRecorderRef.current.stop()
    }
    stopMediaTracks()
  }, [stopMediaTracks])

  const confirmRecording = useCallback(async () => {
    if (!material || !pendingAnchor || !reviewAudio) return

    setIsUploading(true)
    setRecordingError("")

    try {
      const audioFile = new File([reviewAudio.blob], `${material.subjectId}-${material.sessionDate}.webm`, {
        type: reviewAudio.mimeType,
      })

      const sessionResponse = await fetch("/api/subject-day-entries/upload-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subjectId: material.subjectId,
          subjectName: material.subjectName,
          sessionDate: material.sessionDate,
          weekNumber: material.weekNumber,
          materialId: material.id,
          mimeType: audioFile.type || "audio/webm",
        }),
      })
      const sessionPayload = (await requireOkJson(
        sessionResponse,
        "No se pudo preparar la subida del audio."
      )) as DriveUploadSessionResponse

      const { driveFileId } = await uploadBlobToDrive(sessionPayload, audioFile)

      const entryResponse = await fetch("/api/subject-day-entries/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subjectId: material.subjectId,
          sessionDate: material.sessionDate,
          weekNumber: material.weekNumber,
          materialId: material.id,
          driveFileId,
          fileName: audioFile.name,
        }),
      })
      const entryPayload = await requireOkJson(entryResponse, "No se pudo confirmar el audio.")

      const createdEntry = entryPayload as { id: number }
      const positionResponse = await fetch(`/api/subject-day-materials/${material.id}/audio-positions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          entryId: createdEntry.id,
          pageNum: pendingAnchor.pageNum,
          xp: pendingAnchor.xp,
          yp: pendingAnchor.yp,
        }),
      })
      const positionPayload = await requireOkJson(positionResponse, "No se pudo guardar la posicion del audio.")

      const createdPosition = positionPayload as AudioPosition
      setPositions((previous) => {
        const next = [...previous.filter((position) => position.entryId !== createdPosition.entryId), createdPosition]
        next.sort((left, right) => left.entryId - right.entryId)
        syncPositionsToViewer(next)
        return next
      })
      postToViewer({ type: "anchoredAudioCreated", position: createdPosition })
      closeRecorder()
    } catch (error) {
      console.error("Failed to confirm anchored audio:", error)
      setRecordingError(error instanceof Error ? error.message : "No se pudo confirmar el audio.")
    } finally {
      setIsUploading(false)
    }
  }, [closeRecorder, material, pendingAnchor, postToViewer, reviewAudio, syncPositionsToViewer])

  const uploadPracticeFragment = useCallback(
    async (payload: FragmentUploadPayload) => {
      if (!activeContext) return

      setUploadFeedback("Subiendo PDF fragmentado...")
      postToViewer({ type: "practiceFragmentUploadState", status: "uploading" })

      try {
        const rawFileName = typeof payload.fileName === "string" ? payload.fileName : ""
        const safeFileName = rawFileName.trim() || `fragmento-${activeContext.sessionDate}.pdf`
        const fileName = safeFileName.toLowerCase().endsWith(".pdf") ? safeFileName : `${safeFileName}.pdf`

        const sessionResponse = await fetch("/api/subject-day-materials/upload-session", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            subjectId: activeContext.subjectId,
            subjectName: activeContext.subjectName,
            sessionDate: activeContext.sessionDate,
            weekNumber: activeContext.weekNumber,
            materialType: "practice",
            mimeType: "application/pdf",
            fileName,
          }),
        })
        const sessionPayload = (await requireOkJson(
          sessionResponse,
          "No se pudo preparar la subida del PDF fragmentado."
        )) as DriveUploadSessionResponse

        const { driveFileId } = await uploadBlobToDrive(sessionPayload, payload.blob)

        await requireOkJson(
          await fetch("/api/subject-day-materials/complete", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              subjectId: activeContext.subjectId,
              sessionDate: activeContext.sessionDate,
              weekNumber: activeContext.weekNumber,
              materialType: "practice",
              driveFileId,
              fileName,
            }),
          }),
          "No se pudo confirmar el PDF fragmentado."
        )

        setUploadFeedback(`PDF creado: ${fileName}`)
        postToViewer({
          type: "practiceFragmentUploadState",
          status: "success",
          fileName,
        })
        notifyPracticeMaterialsRefresh({
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
    [activeContext, postToViewer]
  )

  const handleViewerMessage = useCallback(
    (event: MessageEvent<ViewerMessage>) => {
      if (event.origin !== window.location.origin || event.source !== iframeRef.current?.contentWindow || !event.data?.type) {
        return
      }

      if (event.data.type === "viewerReady") {
        syncPositionsToViewer(hasMaterial ? positions : [])
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
        setRecordingError("")
        setPendingAnchor(event.data.payload)
        setIsRecorderOpen(true)
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
      }

      if (event.data.type === "deleteAnchoredAudio") {
        const entryId = Number(event.data.entryId)
        if (!Number.isInteger(entryId)) return

        void (async () => {
          try {
            const response = await fetch(`/api/subject-day-entries/${entryId}`, {
              method: "DELETE",
            })
            const payload = await readResponsePayload(response)
            if (!response.ok) {
              throw new Error(getErrorMessage(payload, "No se pudo borrar el audio."))
            }

            setPositions((previous) => {
              const next = previous.filter((position) => position.entryId !== entryId)
              syncPositionsToViewer(next)
              return next
            })
            if (activeEntryId === entryId) {
              audioRef.current?.pause()
              setActiveEntryId(null)
            }
            postToViewer({ type: "anchoredAudioDeleted", entryId })
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
    [activeEntryId, closeRecorder, hasMaterial, loadPositions, material, positions, postToViewer, syncPositionsToViewer, uploadPracticeFragment]
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
    return () => {
      stopAndDiscardRecording()
      stopMediaTracks()
      disposeReviewAudio()
    }
  }, [disposeReviewAudio, stopAndDiscardRecording, stopMediaTracks])

  return (
    <main className="min-h-screen bg-slate-950 text-white">
      <iframe
        ref={iframeRef}
        title={`Visor PDF: ${material?.fileName || "fragmentador"}`}
        src={viewerSrc}
        className="h-screen w-full border-0"
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
        allowFullScreen
        onLoad={() => syncPositionsToViewer(hasMaterial ? positions : [])}
      />

      <audio ref={audioRef} hidden preload="none" />

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

      {material && isRecorderOpen ? (
        <div className="fixed inset-0 z-[1500] flex items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-lg rounded-3xl border border-white/10 bg-slate-900 p-6 shadow-2xl">
            <div className="space-y-2">
              <p className="text-xs uppercase tracking-[0.24em] text-slate-400">Audio anclado</p>
              <h2 className="text-2xl font-semibold text-white">Grabar duda en el PDF</h2>
              <p className="text-sm text-slate-300">
                {material.subjectName} · {material.sessionDate} · pagina {pendingAnchor?.pageNum ?? "-"}
              </p>
            </div>

            <div className="mt-6 space-y-4">
              {reviewAudio ? (
                <audio controls src={reviewAudio.url} className="w-full" />
              ) : (
                <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-5 text-sm text-slate-300">
                  {isRecording ? "Grabando audio..." : "Pulsa grabar para registrar la duda en esta posicion."}
                </div>
              )}

              {recordingError ? <div className="text-sm text-red-300">{recordingError}</div> : null}

              <div className="flex flex-wrap items-center justify-between gap-3">
                <button
                  type="button"
                  onClick={closeRecorder}
                  disabled={isUploading}
                  className="rounded-xl border border-white/15 px-4 py-2 text-sm text-slate-200 transition hover:bg-white/10 disabled:opacity-40"
                >
                  Cancelar
                </button>

                <div className="flex flex-wrap items-center gap-3">
                  {!isRecording ? (
                    <button
                      type="button"
                      onClick={() => void startRecording()}
                      disabled={isUploading}
                      className="rounded-xl bg-red-500 px-4 py-2 text-sm font-medium text-white transition hover:bg-red-400 disabled:opacity-40"
                    >
                      {reviewAudio ? "Regrabar" : "Grabar"}
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={stopRecording}
                      disabled={isUploading}
                      className="rounded-xl bg-amber-500 px-4 py-2 text-sm font-medium text-black transition hover:bg-amber-400 disabled:opacity-40"
                    >
                      Detener
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={() => void confirmRecording()}
                    disabled={!reviewAudio || isUploading}
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
