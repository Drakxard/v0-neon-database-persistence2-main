"use client"

import { useEffect, useState } from "react"
import { Mic } from "lucide-react"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog"
import { useSubjectVoice } from "@/hooks/use-subject-voice"
import { cn } from "@/lib/utils"

export function VoiceModeButton({ active, label, onClick }: {
  active: boolean
  label: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      title={label}
      onClick={onClick}
      className={cn(
        "flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-[#c7c7c7] text-black transition-colors hover:bg-[#b9b9b9] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-black sm:h-16 sm:w-16",
        active && "bg-[#b8d3c3] ring-2 ring-[#528169] ring-offset-2 hover:bg-[#a9c7b5]"
      )}
    >
      <Mic aria-hidden="true" className="h-6 w-6 fill-current sm:h-8 sm:w-8" strokeWidth={2.5} />
    </button>
  )
}

export function SubjectVoiceDialog({ subject, onClose }: {
  subject: { id: string; name: string } | null
  onClose: () => void
}) {
  const [paused, setPaused] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const [serviceError, setServiceError] = useState("")
  const voice = useSubjectVoice(subject?.id ?? null, !paused, attempt)

  useEffect(() => { setPaused(false) }, [subject?.id])

  useEffect(() => {
    setServiceError("")
    if (!subject) return
    const controller = new AbortController()
    // Check configuration only. Evaluation awaits the future instructions and question schema.
    void fetch("/api/subject-voice", { signal: controller.signal, cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("El modelo de voz todavía no está disponible.")
      })
      .catch(() => {
        if (!controller.signal.aborted) setServiceError("El modelo de voz todavía no está disponible. Podés seguir dictando.")
      })
    return () => controller.abort()
  }, [subject?.id, attempt])

  return (
    <Dialog open={Boolean(subject)} onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent
        showCloseButton={false}
        className="inset-0 top-0 left-0 flex h-dvh max-h-dvh w-screen max-w-none translate-x-0 translate-y-0 flex-col gap-0 rounded-none border-0 bg-white p-5 text-black shadow-none sm:max-w-none sm:p-8"
      >
        <div className="flex shrink-0 items-start justify-between gap-5">
          <DialogTitle className="pt-1 text-2xl leading-tight font-normal sm:text-[32px]">
            {subject?.name}
          </DialogTitle>
          <VoiceModeButton
            active={!paused && voice.status !== "error"}
            label={voice.status === "error" ? "Reintentar micrófono" : paused ? "Activar micrófono" : "Pausar micrófono"}
            onClick={() => {
              if (voice.status === "error") {
                setPaused(false)
              } else setPaused((value) => !value)
              setAttempt((value) => value + 1)
            }}
          />
        </div>
        <DialogDescription className="sr-only">
          Dictado para {subject?.name}. Presioná Escape para cerrar.
        </DialogDescription>
        <div className="min-h-0 flex-1 overflow-y-auto pt-10 sm:pt-14" data-subject-voice-canvas>
          {(voice.transcript || voice.interim) && (
            <p className="max-w-4xl text-lg leading-relaxed whitespace-pre-wrap sm:text-xl">
              {voice.transcript}{voice.transcript && voice.interim ? " " : ""}
              <span className="text-neutral-400">{voice.interim}</span>
            </p>
          )}
        </div>
        <p className="sr-only" role="status" aria-live="polite">
          {paused ? "Micrófono pausado" : voice.status === "listening" ? "Escuchando" : voice.status === "starting" ? "Activando micrófono" : "Micrófono detenido"}
        </p>
        {(voice.error || serviceError) && (
          <p role="status" className="mt-4 shrink-0 text-sm text-neutral-600">{voice.error || serviceError}</p>
        )}
      </DialogContent>
    </Dialog>
  )
}
