"use client"

import { useCallback, useEffect, useRef, useState } from "react"

const PREFERENCE_KEY = "inscreen:synthesis:voice-enabled"

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
  stop: () => void
}
type RecognitionConstructor = new () => Recognition
type SpeechWindow = Window & { SpeechRecognition?: RecognitionConstructor; webkitSpeechRecognition?: RecognitionConstructor }

export type SynthesisSpeechStatus = "off" | "starting" | "listening" | "resume" | "unsupported" | "error"

export function useSynthesisSpeech(active: boolean, onPhrase: (phrase: string) => void) {
  const [enabled, setEnabled] = useState(false)
  const [status, setStatus] = useState<SynthesisSpeechStatus>("off")
  const enabledRef = useRef(false)
  const activeRef = useRef(active)
  const blockedRef = useRef(false)
  const recognitionRef = useRef<Recognition | null>(null)
  const restartTimerRef = useRef<number | null>(null)
  const onPhraseRef = useRef(onPhrase)
  onPhraseRef.current = onPhrase

  const stopRecognition = useCallback(() => {
    if (restartTimerRef.current !== null) window.clearTimeout(restartTimerRef.current)
    restartTimerRef.current = null
    const recognition = recognitionRef.current
    recognitionRef.current = null
    if (recognition) {
      recognition.onend = null
      recognition.onresult = null
      recognition.onerror = null
      try { recognition.stop() } catch { /* Already stopped by the browser. */ }
    }
  }, [])

  const startRecognition = useCallback(() => {
    if (!enabledRef.current || !activeRef.current || blockedRef.current || recognitionRef.current) return
    const speechWindow = window as SpeechWindow
    const Constructor = speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition
    if (!Constructor) { setStatus("unsupported"); return }
    const recognition = new Constructor()
    const processed = new Set<number>()
    recognitionRef.current = recognition
    recognition.lang = "es-AR"
    recognition.continuous = true
    recognition.interimResults = true
    recognition.maxAlternatives = 1
    recognition.onstart = () => setStatus("listening")
    recognition.onresult = (event) => {
      for (let index = event.resultIndex; index < event.results.length; index++) {
        const result = event.results[index]
        if (!result?.isFinal || processed.has(index)) continue
        processed.add(index)
        const phrase = result[0]?.transcript?.trim()
        if (phrase) onPhraseRef.current(phrase)
      }
    }
    recognition.onerror = (event) => {
      if (event.error === "no-speech" || event.error === "aborted") return
      blockedRef.current = true
      setStatus(event.error === "not-allowed" || event.error === "service-not-allowed" ? "resume" : "error")
    }
    recognition.onend = () => {
      if (recognitionRef.current !== recognition) return
      recognitionRef.current = null
      if (!enabledRef.current || !activeRef.current || blockedRef.current) return
      restartTimerRef.current = window.setTimeout(() => startRecognition(), 350)
    }
    try { setStatus("starting"); recognition.start() }
    catch {
      recognitionRef.current = null
      blockedRef.current = true
      setStatus("resume")
    }
  }, [])

  useEffect(() => {
    const syncVisibility = () => {
      activeRef.current = active && document.visibilityState === "visible"
      if (!activeRef.current) { stopRecognition(); return }
      if (enabledRef.current && !blockedRef.current) startRecognition()
    }
    syncVisibility()
    document.addEventListener("visibilitychange", syncVisibility)
    return () => document.removeEventListener("visibilitychange", syncVisibility)
  }, [active, startRecognition, stopRecognition])

  useEffect(() => {
    try {
      if (window.localStorage.getItem(PREFERENCE_KEY) === "1") {
        enabledRef.current = true
        setEnabled(true)
        if (activeRef.current) startRecognition()
      }
    } catch { /* The button still works when browser storage is unavailable. */ }
    return () => stopRecognition()
  }, [startRecognition, stopRecognition])

  const toggle = useCallback(() => {
    if (enabledRef.current) {
      enabledRef.current = false
      setEnabled(false)
      setStatus("off")
      stopRecognition()
      try { window.localStorage.setItem(PREFERENCE_KEY, "0") } catch { /* Optional preference. */ }
      return
    }
    enabledRef.current = true
    blockedRef.current = false
    setEnabled(true)
    try { window.localStorage.setItem(PREFERENCE_KEY, "1") } catch { /* Optional preference. */ }
    startRecognition()
  }, [startRecognition, stopRecognition])

  const retry = useCallback(() => {
    blockedRef.current = false
    stopRecognition()
    startRecognition()
  }, [startRecognition, stopRecognition])

  return { enabled, status, toggle, retry }
}
