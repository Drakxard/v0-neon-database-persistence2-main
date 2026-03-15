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

type ViewerMessage =
  | { type: "startAnchoredAudio"; payload?: PendingAnchor }
  | { type: "cancelAnchoredAudio" }
  | { type: "playAnchoredAudio"; entryId?: number }
  | { type: "deleteAnchoredAudio"; entryId?: number }
  | { type: "viewerReady" }

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

function buildViewerSrc(material: MaterialContext) {
  const params = new URLSearchParams({
    url: `/api/subject-day-materials/${material.id}/file`,
    name: material.fileName,
    key: `subject-day-material-${material.id}`,
    materialId: String(material.id),
    subjectId: material.subjectId,
    subjectName: material.subjectName,
    sessionDate: material.sessionDate,
    weekNumber: String(material.weekNumber),
    weekdayIndex: String(material.weekdayIndex),
  })

  return `/visor/index.html?${params.toString()}`
}

export function PracticeViewerClient({ material }: { material: MaterialContext }) {
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

  const viewerSrc = useMemo(() => buildViewerSrc(material), [material])

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
  }, [material.id, syncPositionsToViewer])

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
    if (!pendingAnchor || !reviewAudio) return

    setIsUploading(true)
    setRecordingError("")

    try {
      const formData = new FormData()
      formData.append("subjectId", material.subjectId)
      formData.append("subjectName", material.subjectName)
      formData.append("sessionDate", material.sessionDate)
      formData.append("weekNumber", String(material.weekNumber))
      formData.append("weekdayIndex", String(material.weekdayIndex))
      formData.append("materialId", String(material.id))
      formData.append(
        "audio",
        new File([reviewAudio.blob], `${material.subjectId}-${material.sessionDate}.webm`, { type: reviewAudio.mimeType })
      )

      const entryResponse = await fetch("/api/subject-day-entries", {
        method: "POST",
        body: formData,
      })
      const entryPayload = await entryResponse.json()
      if (!entryResponse.ok) {
        throw new Error(getErrorMessage(entryPayload, "No se pudo confirmar el audio."))
      }

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
      const positionPayload = await positionResponse.json()
      if (!positionResponse.ok) {
        throw new Error(getErrorMessage(positionPayload, "No se pudo guardar la posicion del audio."))
      }

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

  const handleViewerMessage = useCallback(
    (event: MessageEvent<ViewerMessage>) => {
      if (event.origin !== window.location.origin || event.source !== iframeRef.current?.contentWindow || !event.data?.type) {
        return
      }

      if (event.data.type === "viewerReady") {
        syncPositionsToViewer(positions)
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
            const payload = await response.json().catch(() => ({}))
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
    [activeEntryId, closeRecorder, loadPositions, positions, postToViewer, syncPositionsToViewer]
  )

  useEffect(() => {
    loadPositions()
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
        title={`Visor PDF: ${material.fileName}`}
        src={viewerSrc}
        className="h-screen w-full border-0"
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
        allowFullScreen
        onLoad={() => syncPositionsToViewer(positions)}
      />

      <audio ref={audioRef} hidden preload="none" />

      {positionsError ? (
        <div className="fixed bottom-4 left-4 z-[1400] max-w-md rounded-xl border border-red-400/40 bg-red-950/90 px-4 py-3 text-sm text-red-100">
          {positionsError}
        </div>
      ) : null}

      {isRecorderOpen ? (
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
