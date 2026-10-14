"use client"

import { useEffect, useRef, useState } from "react"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog"
import { TTS_MODELS, validateTtsRequest } from "@/lib/tts-models"
import { cn } from "@/lib/utils"

export function TtsTestDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [modelId, setModelId] = useState(TTS_MODELS[0].id)
  const [voiceId, setVoiceId] = useState<string | undefined>(TTS_MODELS[0].defaultVoice)
  const [text, setText] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [manualPlay, setManualPlay] = useState(false)
  const controller = useRef<AbortController | null>(null)
  const audio = useRef<HTMLAudioElement | null>(null)
  const audioUrl = useRef<string | null>(null)

  function stop() {
    controller.current?.abort()
    controller.current = null
    audio.current?.pause()
    if (audio.current) { audio.current.removeAttribute("src"); audio.current.load() }
    audio.current = null
    if (audioUrl.current) URL.revokeObjectURL(audioUrl.current)
    audioUrl.current = null
  }

  useEffect(() => {
    if (!open) { stop(); setBusy(false); setManualPlay(false); setError("") }
    return stop
  }, [open])

  function changeSelection(nextModelId: string, nextVoiceId?: string) {
    stop()
    setBusy(false)
    setManualPlay(false)
    setError("")
    setModelId(nextModelId)
    setVoiceId(nextVoiceId)
  }

  async function play() {
    const player = audio.current
    if (!player) return
    try {
      await player.play()
      if (audio.current === player) setManualPlay(false)
    } catch (reason) {
      if (audio.current !== player) return
      if (reason instanceof DOMException && reason.name === "NotAllowedError") setManualPlay(true)
      else setError("El navegador no pudo reproducir el audio.")
    }
  }

  async function send() {
    if (controller.current) return
    try { validateTtsRequest({ modelId, voiceId, text }) }
    catch (reason) { setError((reason as Error).message); return }
    stop()
    const pending = new AbortController()
    controller.current = pending
    setBusy(true)
    setError("")
    setManualPlay(false)
    try {
      const response = await fetch("/api/tts", {
        method: "POST", signal: pending.signal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ modelId, voiceId, text }),
      })
      if (!response.ok) {
        const payload = await response.json().catch(() => null)
        throw new Error(payload?.error ?? "No se pudo generar el audio.")
      }
      const blob = await response.blob()
      if (pending.signal.aborted || controller.current !== pending) return
      if (!blob.size || !blob.type.startsWith("audio/")) throw new Error("La respuesta no contiene audio reproducible.")
      audioUrl.current = URL.createObjectURL(blob)
      audio.current = new Audio(audioUrl.current)
      await play()
    } catch (reason) {
      if (!pending.signal.aborted && controller.current === pending) setError(reason instanceof Error ? reason.message : "No se pudo generar el audio.")
    } finally {
      if (controller.current === pending) { controller.current = null; setBusy(false) }
    }
  }

  const rowClass = "block w-full whitespace-normal break-words rounded-md px-3 py-2.5 text-left text-sm leading-relaxed hover:bg-neutral-100 focus-visible:outline-2 focus-visible:outline-neutral-600"
  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) stop(); onOpenChange(next) }}>
      <DialogContent className="inset-0 top-0 left-0 flex h-dvh max-h-dvh w-screen max-w-none translate-x-0 translate-y-0 flex-col gap-0 rounded-none border-0 bg-white p-0 text-black shadow-none sm:max-w-none">
        <DialogTitle className="sr-only">Probar voces en español</DialogTitle>
        <DialogDescription className="sr-only">Elegí un modelo y una voz. Enter genera y reproduce el texto en español; Shift más Enter agrega una línea. Escape cierra.</DialogDescription>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 pt-12 pb-4 sm:px-8" role="radiogroup" aria-label="Modelos y voces en español"
          onKeyDown={(event) => {
            if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return
            const rows = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>("[data-tts-row]"))
            const index = rows.indexOf(event.target as HTMLButtonElement)
            if (index < 0) return
            event.preventDefault()
            const next = event.key === "Home" ? 0 : event.key === "End" ? rows.length - 1 : (index + (event.key === "ArrowDown" ? 1 : -1) + rows.length) % rows.length
            rows[next]?.focus()
          }}>
          <div className="mx-auto max-w-2xl space-y-1">
            {TTS_MODELS.map((entry) => {
              const selected = entry.id === modelId
              return <div key={entry.id}>
                <button type="button" data-tts-row
                  role={entry.voices.length ? undefined : "radio"}
                  aria-checked={entry.voices.length ? undefined : selected}
                  aria-expanded={entry.voices.length ? selected : undefined}
                  aria-controls={entry.voices.length ? `tts-voices-${entry.id}` : undefined}
                  className={cn(rowClass, selected && !entry.voices.length && "bg-neutral-200 hover:bg-neutral-200")}
                  onClick={() => changeSelection(entry.id, entry.defaultVoice)}>
                  {entry.id} <span className="text-neutral-500">({entry.provider})</span>
                </button>
                {entry.voices.length > 0 && <div id={`tts-voices-${entry.id}`} hidden={!selected} className="ml-4 border-l border-neutral-200 pl-2">
                  {selected && entry.voices.map((voice) => <button type="button" key={voice} data-tts-row role="radio" aria-checked={voice === voiceId}
                    className={cn(rowClass, voice === voiceId && "bg-neutral-200 hover:bg-neutral-200")}
                    onClick={() => changeSelection(entry.id, voice)}>{voice}</button>)}
                </div>}
              </div>
            })}
          </div>
        </div>
        <div className="shrink-0 border-t border-neutral-200 px-4 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))] sm:px-8">
          <div className="mx-auto max-w-2xl">
            <textarea aria-label="Texto en español" placeholder="Escribí en español · Enter para escuchar" value={text} rows={3}
              className="block max-h-[30dvh] min-h-24 w-full resize-none rounded-md border border-neutral-300 bg-white px-3 py-3 text-base text-black outline-none focus:border-neutral-600"
              onChange={(event) => { setText(event.target.value); setError("") }}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void send() }
              }} />
            <div className="mt-1 flex min-h-6 items-center gap-3 text-xs text-neutral-600" role="status" aria-live="polite">
              {busy ? "Generando audio…" : error}
              {manualPlay && <button type="button" className="rounded px-2 py-1 underline focus-visible:outline-2" onClick={() => void play()}>Reproducir</button>}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
