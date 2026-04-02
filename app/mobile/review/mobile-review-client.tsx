"use client"

import { useEffect, useRef, useState } from "react"

type MobileReviewPair = {
  pairId: string
  subjectId: string
  subjectName: string
  weekNumber: number
  sessionDate: string
  questionEntryId: number
  questionAudioUrl: string
  questionLabel: string
  answerEntryId: number
  answerAudioUrl: string
  answerLabel: string
}

type MobileReviewStatus = {
  deviceId: string
  activeSlot: {
    weekdayIndex: number
    startTime: string
    endTime: string
    subjectId: string
    subjectName: string
  } | null
  subjectId: string | null
  subjectName: string | null
  weekNumber: number
  hasCurrentPair: boolean
  currentPairId: string | null
}

type MobileReviewPayload = {
  pair: MobileReviewPair | null
  status: MobileReviewStatus
}

type Props = {
  deviceId: string
  signature: string
  initialPayload: MobileReviewPayload | null
  initialError: string
}

function AudioRow({
  label,
  audioRef,
  src,
  onPlay,
}: {
  label: string
  audioRef: React.RefObject<HTMLAudioElement | null>
  src: string
  onPlay: () => void
}) {
  return (
    <section className="space-y-2">
      <p className="text-[1.9rem] leading-none text-black">{label}</p>
      <div className="flex items-center gap-4">
        <button
          type="button"
          onClick={onPlay}
          className="grid h-10 w-10 place-items-center rounded-full text-black transition hover:opacity-80"
          aria-label={`Reproducir ${label}`}
        >
          <span
            aria-hidden="true"
            className="ml-1 block h-0 w-0 border-b-[10px] border-l-[16px] border-t-[10px] border-b-transparent border-l-black border-t-transparent"
          />
        </button>
        <div className="h-1 flex-1 rounded-full bg-black/90" />
      </div>
      <audio ref={audioRef} src={src} preload="auto" className="hidden" />
    </section>
  )
}

export function MobileReviewClient({ deviceId, signature, initialPayload, initialError }: Props) {
  const [payload, setPayload] = useState<MobileReviewPayload | null>(initialPayload)
  const [error, setError] = useState(initialError)
  const [isLoading, setIsLoading] = useState(false)
  const questionAudioRef = useRef<HTMLAudioElement | null>(null)
  const answerAudioRef = useRef<HTMLAudioElement | null>(null)

  useEffect(() => {
    if (!payload?.pair) return
    const questionAudio = questionAudioRef.current
    if (!questionAudio) return
    questionAudio.currentTime = 0
    void questionAudio.play().catch(() => {})
  }, [payload?.pair?.pairId])

  const playQuestion = () => {
    const audio = questionAudioRef.current
    if (!audio) return
    audio.currentTime = 0
    void audio.play().catch(() => {})
  }

  const playAnswer = () => {
    const audio = answerAudioRef.current
    if (!audio) return
    audio.currentTime = 0
    void audio.play().catch(() => {})
  }

  const loadNext = async () => {
    setIsLoading(true)
    setError("")
    try {
      const response = await fetch("/api/mobile/review/next", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          device: deviceId,
          sig: signature,
        }),
      })
      const nextPayload = (await response.json()) as MobileReviewPayload & { error?: string }
      if (!response.ok) {
        throw new Error(nextPayload.error || "No se pudo cargar el siguiente audio.")
      }
      setPayload({
        pair: nextPayload.pair,
        status: nextPayload.status,
      })
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "No se pudo cargar el siguiente audio.")
    } finally {
      setIsLoading(false)
    }
  }

  const subjectTitle = payload?.pair?.subjectName || payload?.status.subjectName || "Sin materia"

  return (
    <main className="min-h-screen bg-[#f1e4a9] px-3 py-2 text-black">
      <div className="mx-auto flex min-h-[calc(100vh-1rem)] w-full max-w-[320px] flex-col border-4 border-black bg-[#f1e4a9] px-3 py-4">
        <header className="pb-5 text-center text-[2rem] leading-none text-black">{subjectTitle}</header>

        <div className="flex-1 space-y-10">
          <AudioRow
            label="Pregunta"
            audioRef={questionAudioRef}
            src={payload?.pair?.questionAudioUrl || ""}
            onPlay={playQuestion}
          />

          <AudioRow
            label="Respuesta"
            audioRef={answerAudioRef}
            src={payload?.pair?.answerAudioUrl || ""}
            onPlay={playAnswer}
          />

          {error ? <p className="text-sm text-red-700">{error}</p> : null}
          {!error && !payload?.pair ? (
            <p className="text-sm text-black/80">No hay un par disponible para la franja actual.</p>
          ) : null}
        </div>

        <button
          type="button"
          onClick={() => void loadNext()}
          disabled={isLoading}
          className="mt-6 text-left text-[1.9rem] leading-none text-black disabled:opacity-60"
        >
          {isLoading ? "Cargando..." : "Siguiente pregunta"}
        </button>
      </div>
    </main>
  )
}
