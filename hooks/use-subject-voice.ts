"use client"

import { useEffect, useRef, useState } from "react"

type SpeechResult = { isFinal: boolean; 0: { transcript: string } }
type SpeechEvent = { resultIndex: number; results: ArrayLike<SpeechResult> }
type Recognition = {
  lang: string
  continuous: boolean
  interimResults: boolean
  maxAlternatives: number
  onstart: (() => void) | null
  onend: (() => void) | null
  onerror: ((event: { error: string }) => void) | null
  onresult: ((event: SpeechEvent) => void) | null
  start: () => void
  abort: () => void
}
type SpeechWindow = Window & {
  SpeechRecognition?: new () => Recognition
  webkitSpeechRecognition?: new () => Recognition
}

export function useSubjectVoice(subjectId: string | null, listening: boolean, attempt = 0, onText?: (final: string, interim: string) => void) {
  const textListener = useRef(onText)
  textListener.current = onText
  const [transcript, setTranscript] = useState("")
  const [interim, setInterim] = useState("")
  const [status, setStatus] = useState<"off" | "starting" | "listening" | "error">("off")
  const [error, setError] = useState("")

  useEffect(() => {
    setTranscript("")
    setInterim("")
    setError("")
  }, [subjectId])

  useEffect(() => {
    if (!subjectId || !listening) {
      setStatus("off")
      setInterim("")
      textListener.current?.("", "")
      setError("")
      return
    }
    const speechWindow = window as SpeechWindow
    const Constructor = speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition
    if (!Constructor) {
      setStatus("error")
      setError("Este navegador no admite dictado por voz. Probá con Chrome o Edge.")
      return
    }
    let disposed = false
    let blocked = false
    let recognition: Recognition | null = null
    let restartTimer: number | undefined
    setError("")

    const stop = () => {
      window.clearTimeout(restartTimer)
      if (!recognition) return
      recognition.onstart = null
      recognition.onend = null
      recognition.onerror = null
      recognition.onresult = null
      try { recognition.abort() } catch { /* The browser may have already stopped it. */ }
      recognition = null
      setInterim("")
      textListener.current?.("", "")
    }
    const start = () => {
      if (disposed || blocked || recognition || document.visibilityState !== "visible") return
      const current = new Constructor()
      recognition = current
      const processed = new Set<number>()
      current.lang = "es-AR"
      current.continuous = true
      current.interimResults = true
      current.maxAlternatives = 1
      current.onstart = () => { if (!disposed) setStatus("listening") }
      current.onresult = (event) => {
        if (disposed || blocked) return
        const finalParts: string[] = []
        const interimParts: string[] = []
        for (let index = 0; index < event.results.length; index++) {
          const result = event.results[index]
          const phrase = result?.[0]?.transcript?.trim()
          if (!phrase) continue
          if (!result.isFinal) interimParts.push(phrase)
          else if (!processed.has(index)) {
            processed.add(index)
            finalParts.push(phrase)
          }
        }
        if (finalParts.length) setTranscript((previous) => [previous, ...finalParts].filter(Boolean).join(" "))
        setInterim(interimParts.join(" "))
        textListener.current?.(finalParts.join(" "), interimParts.join(" "))
      }
      current.onerror = (event) => {
        if (disposed || event.error === "no-speech" || event.error === "aborted") return
        blocked = true
        setStatus("error")
        setError(event.error === "not-allowed" || event.error === "service-not-allowed"
          ? "Permití el acceso al micrófono y volvé a activarlo."
          : event.error === "audio-capture"
            ? "No se encontró un micrófono disponible."
            : "No se pudo iniciar el dictado. Tocá el micrófono para reintentar.")
        stop()
      }
      current.onend = () => {
        if (disposed || recognition !== current) return
        recognition = null
        setInterim("")
        textListener.current?.("", "")
        if (!blocked) {
          setStatus("starting")
          restartTimer = window.setTimeout(start, 350)
        }
      }
      try {
        setStatus("starting")
        current.start()
      } catch {
        blocked = true
        stop()
        setStatus("error")
        setError("No se pudo iniciar el dictado. Tocá el micrófono para reintentar.")
      }
    }
    const syncVisibility = () => {
      if (document.visibilityState === "visible") start()
      else { stop(); if (!blocked) setStatus("off") }
    }
    start()
    document.addEventListener("visibilitychange", syncVisibility)
    return () => {
      disposed = true
      stop()
      document.removeEventListener("visibilitychange", syncVisibility)
    }
  }, [subjectId, listening, attempt])

  return { transcript, interim, status, error }
}
