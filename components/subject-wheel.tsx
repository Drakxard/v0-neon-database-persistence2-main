"use client"

import { useState, useMemo, useEffect, useRef, useCallback } from "react"
import { ChevronLeft, ChevronRight, RotateCcw, Check, Copy, Loader2, Plus, Sparkles, GraduationCap, Pencil, X, Link2, Mic, Pause, Play, Square } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Input } from "@/components/ui/input"
import { formatDateKey, getWeekDates, getWeekNumberForDate, getWeekdayLabel, parseDateKey } from "@/lib/subject-utils"

interface Subject {
  id: string
  name: string
  color: string
}

interface Question {
  id: number
  pregunta: string
  respuesta: string
  estado: "bien" | "erre" | null
  id_materia: number
  semana: number
  example_image_url: string | null
  example_link: string
}

interface QuestionDraft {
  pregunta: string
  respuesta: string
}

interface SubjectDayEntryLink {
  id: number
  label: string
  url: string
}

interface SubjectDayEntry {
  id: number
  subject_id: string
  week_number: number
  session_date: string
  weekday_index: number
  order_index: number
  transcript_text: string
  drive_file_id: string
  drive_file_name: string
  drive_mime_type: string
  drive_web_view_link: string
  answer_text: string | null
  custom_title: string | null
  display_title: string
  practice_state: "erre" | null
  external_links: SubjectDayEntryLink[]
  created_at: string
  updated_at: string
}

interface ReviewAudio {
  blob: Blob
  url: string
  mimeType: string
}

const INITIAL_SUBJECTS: Subject[] = [
  { id: "algebra", name: "Álgebra 2", color: "#0098C8" },
  { id: "calculo2", name: "Cálculo 2", color: "#2563eb" },
  { id: "calculo3", name: "Cálculo 3", color: "#ea580c" },
  { id: "fisica", name: "Física 1", color: "#dc2626" },
  { id: "logica", name: "Lógica y\ncomputabilidad", color: "#16a34a" },
  { id: "probabilidad", name: "Probabilidad y\nEstadística", color: "#a855f7" },
]

// Map subject id to numeric index (0-5) for DB
const SUBJECT_ID_TO_INDEX: Record<string, number> = {
  algebra: 0,
  calculo2: 1,
  calculo3: 2,
  fisica: 3,
  logica: 4,
  probabilidad: 5,
}

function getCurrentWeekNumber(): number {
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  // Semana 1 empieza el lunes 16/03/2026. Antes de eso es semana 0.
  const weekOneStart = new Date(2026, 2, 16)
  if (today < weekOneStart) return 0

  const msPerDay = 1000 * 60 * 60 * 24
  const diffDays = Math.floor((today.getTime() - weekOneStart.getTime()) / msPerDay)
  return Math.floor(diffDays / 7) + 1
}

function getTodayDateString() {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`
}

function getRecorderMimeType() {
  if (typeof window === "undefined" || typeof MediaRecorder === "undefined") return ""

  const mimeTypes = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"]
  return mimeTypes.find((mimeType) => MediaRecorder.isTypeSupported(mimeType)) || ""
}

function getSubjectDisplayName(subject: Subject | null) {
  return subject?.name.replace("\n", " ") || ""
}

function idsToSubjects(ids: string[]): Subject[] {
  return ids.map((id) => INITIAL_SUBJECTS.find((s) => s.id === id)).filter(Boolean) as Subject[]
}

function subjectsToIds(subjects: Subject[]): string[] {
  return subjects.map((s) => s.id)
}

type SaveStatus = "idle" | "saving" | "saved" | "error"
type PracticeFilters = {
  random: boolean
  unanswered: boolean
  erre: boolean
}

function shuffleQuestions<T>(items: T[]): T[] {
  const shuffled = [...items]
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const randomIndex = Math.floor(Math.random() * (index + 1))
    ;[shuffled[index], shuffled[randomIndex]] = [shuffled[randomIndex], shuffled[index]]
  }

  return shuffled
}

async function parseJsonResponse(response: Response) {
  const text = await response.text()
  if (!text) return null

  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

function getErrorMessage(payload: unknown, fallback: string) {
  if (payload && typeof payload === "object" && "error" in payload && typeof payload.error === "string") {
    return payload.error
  }

  if (typeof payload === "string" && payload.trim().length > 0) {
    return payload
  }

  return fallback
}

function getEntryDisplayTitle(entry: Pick<SubjectDayEntry, "display_title" | "custom_title" | "order_index">) {
  const customTitle = entry.custom_title?.trim()
  if (customTitle) return customTitle
  const displayTitle = entry.display_title?.trim()
  if (displayTitle) return displayTitle
  return `Duda ${entry.order_index + 1}`
}

function applyPracticeFilters(entries: SubjectDayEntry[], filters: PracticeFilters, options?: { shuffle?: boolean }) {
  const filteredEntries = entries.filter((entry) => {
    if (filters.unanswered && entry.answer_text?.trim()) return false
    if (filters.erre && entry.practice_state !== "erre") return false
    return true
  })

  return options?.shuffle && filters.random ? shuffleQuestions(filteredEntries) : filteredEntries
}

export function SubjectWheel() {
  const [activeSubjects, setActiveSubjects] = useState<Subject[]>(INITIAL_SUBJECTS)
  const [completedSubjects, setCompletedSubjects] = useState<Subject[]>([])
  const [history, setHistory] = useState<{ active: Subject[]; completed: Subject[] }[]>([])
  const [historyIndex, setHistoryIndex] = useState(-1)
  const [isLoading, setIsLoading] = useState(true)
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle")

  // This ref is only flipped to true AFTER the initial load sets state,
  // so the sync useEffect never fires on the first render with stale default state.
  const readyToSync = useRef(false)

  const [isDialogOpen, setIsDialogOpen] = useState(false)
  const [currentSubject, setCurrentSubject] = useState<Subject | null>(null)
  const [currentDateKey, setCurrentDateKey] = useState(getTodayDateString())
  const [entries, setEntries] = useState<SubjectDayEntry[]>([])
  const [isEntriesLoading, setIsEntriesLoading] = useState(false)
  const [entriesError, setEntriesError] = useState("")
  const [isRecording, setIsRecording] = useState(false)
  const [recordingError, setRecordingError] = useState("")
  const [reviewAudio, setReviewAudio] = useState<ReviewAudio | null>(null)
  const [isReviewDialogOpen, setIsReviewDialogOpen] = useState(false)
  const [isUploadingAudio, setIsUploadingAudio] = useState(false)
  const [editingAnswerId, setEditingAnswerId] = useState<number | null>(null)
  const [answerDrafts, setAnswerDrafts] = useState<Record<number, string>>({})
  const [questionDrafts, setQuestionDrafts] = useState<Record<number, string>>({})
  const [editingTitleId, setEditingTitleId] = useState<number | null>(null)
  const [titleDrafts, setTitleDrafts] = useState<Record<number, string>>({})
  const [revealedAnswers, setRevealedAnswers] = useState<Record<number, boolean>>({})
  const [isSavingAnswerId, setIsSavingAnswerId] = useState<number | null>(null)
  const [isSavingTitleId, setIsSavingTitleId] = useState<number | null>(null)
  const [expandedAudioEntryId, setExpandedAudioEntryId] = useState<number | null>(null)
  const [loadingAudioEntryId, setLoadingAudioEntryId] = useState<number | null>(null)
  const [audioSourceUrls, setAudioSourceUrls] = useState<Record<number, string>>({})
  const [isCopyingEntries, setIsCopyingEntries] = useState(false)
  const [isLinkDialogOpen, setIsLinkDialogOpen] = useState(false)
  const [linkEntryId, setLinkEntryId] = useState<number | null>(null)
  const [linkDraft, setLinkDraft] = useState({ label: "", url: "" })
  const [isSavingLink, setIsSavingLink] = useState(false)

  // Practice modal state
  const [isPracticeOpen, setIsPracticeOpen] = useState(false)
  const [practiceSubjectIndex, setPracticeSubjectIndex] = useState<number | null>(null)
  const [practiceSubjectId, setPracticeSubjectId] = useState<string>("")
  const [practiceWeekNumber, setPracticeWeekNumber] = useState<string>("")
  const [practiceFilters, setPracticeFilters] = useState<PracticeFilters>({ random: false, unanswered: false, erre: false })
  const [practiceEntries, setPracticeEntries] = useState<SubjectDayEntry[]>([])
  const [practiceVisibleEntries, setPracticeVisibleEntries] = useState<SubjectDayEntry[]>([])
  const [currentPracticeIndex, setCurrentPracticeIndex] = useState(0)
  const [isPracticeFinished, setIsPracticeFinished] = useState(false)
  const [isAnswerRevealed, setIsAnswerRevealed] = useState(false)
  const [isLoadingPractice, setIsLoadingPractice] = useState(false)
  const [practiceLoadError, setPracticeLoadError] = useState("")
  const [isExampleModalOpen, setIsExampleModalOpen] = useState(false)
  const [exampleLinkDraft, setExampleLinkDraft] = useState("")
  const [exampleImageFile, setExampleImageFile] = useState<File | null>(null)
  const [exampleError, setExampleError] = useState("")
  const practiceQuestions: Question[] = []
  const currentPracticeQuestionId = null

  // AI modal state
  const [isAiOpen, setIsAiOpen] = useState(false)
  const [aiPrompt, setAiPrompt] = useState("")
  const [aiResponse, setAiResponse] = useState("")
  const [isAiLoading, setIsAiLoading] = useState(false)
  const [aiSent, setAiSent] = useState(false)
  const aiResponseRef = useRef<HTMLDivElement>(null)
  // Panoramas indexed by subject id for the AI context
  const [panoramaMap, setPanoramaMap] = useState<Record<string, string>>({})
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const mediaStreamRef = useRef<MediaStream | null>(null)
  const recordingChunksRef = useRef<Blob[]>([])
  const audioCacheRef = useRef<Map<number, string>>(new Map())
  const audioElementRefs = useRef<Record<number, HTMLAudioElement | null>>({})
  const todayKey = getTodayDateString()
  const selectedDate = useMemo(() => parseDateKey(currentDateKey), [currentDateKey])
  const selectedWeekNumber = useMemo(() => getWeekNumberForDate(selectedDate), [selectedDate])
  const weekDates = useMemo(() => getWeekDates(selectedWeekNumber), [selectedWeekNumber])
  const currentDayIndex = weekDates.findIndex((date) => formatDateKey(date) === currentDateKey)
  const lastVisibleDayIndex = weekDates.reduce((lastIndex, date, index) => {
    return formatDateKey(date) <= todayKey ? index : lastIndex
  }, -1)

  // Load from database on mount
  useEffect(() => {
    const loadFromDatabase = async () => {
      try {
        const date = getTodayDateString()
        const response = await fetch(`/api/sessions?date=${date}`)
        if (!response.ok) throw new Error("Failed to fetch session")
        const session = await response.json()

        if (session && Array.isArray(session.active_subject_ids)) {
          const completedSubjectsData = session.completed_subjects || {}
          const completedIds = Object.keys(completedSubjectsData)
          setActiveSubjects(idsToSubjects(session.active_subject_ids))
          setCompletedSubjects(idsToSubjects(completedIds))
        }
        // If no session exists, default INITIAL_SUBJECTS is already set
      } catch (error) {
        console.error("Failed to load from database:", error)
      } finally {
        setIsLoading(false)
        // Only allow syncing AFTER the loaded state has been applied
        setTimeout(() => {
          readyToSync.current = true
        }, 0)
      }
    }

    loadFromDatabase()
  }, [])

  useEffect(() => {
    const currentQuestion = practiceQuestions[currentPracticeIndex]
    setIsExampleModalOpen(false)
    setExampleImageFile(null)
    setExampleError("")
    setExampleLinkDraft(currentQuestion?.example_link || "")
  }, [practiceSubjectIndex, currentPracticeIndex, currentPracticeQuestionId])

  // Sync to database whenever state changes — but only after initial load
  useEffect(() => {
    if (!readyToSync.current) return

    const syncToDatabase = async () => {
      setSaveStatus("saving")
      try {
        const date = getTodayDateString()
        const activeIds = subjectsToIds(activeSubjects)
        const completedObj = completedSubjects.reduce(
          (acc, subject) => {
            acc[subject.id] = true
            return acc
          },
          {} as Record<string, boolean>
        )

        const res = await fetch("/api/sessions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            date,
            activeSubjectIds: activeIds,
            completedSubjects: completedObj,
          }),
        })

        if (!res.ok) throw new Error("Save failed")
        setSaveStatus("saved")
        // Reset to idle after 2 seconds
        setTimeout(() => setSaveStatus("idle"), 2000)
      } catch (error) {
        console.error("Failed to sync to database:", error)
        setSaveStatus("error")
        setTimeout(() => setSaveStatus("idle"), 3000)
      }
    }

    syncToDatabase()
  }, [activeSubjects, completedSubjects])

  // Load persisted AI prompt on mount
  useEffect(() => {
    fetch('/api/ai-prompt')
      .then((r) => r.json())
      .then((data) => { if (data.prompt !== undefined) setAiPrompt(data.prompt) })
      .catch(() => {})
  }, [])

  // Save AI prompt to DB whenever it changes (debounced 800ms)
  const aiPromptSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const handleAiPromptChange = useCallback((value: string) => {
    setAiPrompt(value)
    if (aiPromptSaveTimer.current) clearTimeout(aiPromptSaveTimer.current)
    aiPromptSaveTimer.current = setTimeout(() => {
      fetch('/api/ai-prompt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: value }),
      }).catch(() => {})
    }, 800)
  }, [])

  // Use a ref so the keydown listener never goes stale
  const completedSubjectsRef = useRef(completedSubjects)
  useEffect(() => {
    completedSubjectsRef.current = completedSubjects
  }, [completedSubjects])

  const openAiModal = useCallback(async () => {
    setAiSent(false)
    setAiResponse("")
    // Load panoramas for all completed subjects using the latest ref value
    const date = getTodayDateString()
    const map: Record<string, string> = {}
    await Promise.all(
      completedSubjectsRef.current.map(async (s) => {
        try {
          const res = await fetch(`/api/subject-completions?date=${date}&subjectId=${s.id}`)
          const data = await res.json()
          if (data?.panorama) map[s.id] = data.panorama
        } catch {}
      })
    )
    setPanoramaMap(map)
    setIsAiOpen(true)
  }, [])

  // Global 'g' key listener — registered once, stable via ref
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return
      if (e.key === 'g' || e.key === 'G') {
        openAiModal()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [openAiModal])

  // Auto-scroll AI response box
  useEffect(() => {
    if (aiResponseRef.current) {
      aiResponseRef.current.scrollTop = aiResponseRef.current.scrollHeight
    }
  }, [aiResponse])

  const handleAiSubmit = async () => {
    if (!aiPrompt.trim() || isAiLoading) return
    setIsAiLoading(true)
    setAiResponse("")
    setAiSent(true)

    // Build context string from completed subjects + their panoramas
    const completedContext = completedSubjectsRef.current.length > 0
      ? completedSubjectsRef.current
          .map((s) => {
            const p = panoramaMap[s.id]
            return p ? `${s.name.replace('\n', ' ')}: ${p}` : s.name.replace('\n', ' ')
          })
          .join(', ')
      : ''

    try {
      const res = await fetch('/api/ai-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userPrompt: aiPrompt, completedContext }),
      })

      if (!res.ok || !res.body) throw new Error('Stream failed')

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let done = false
      while (!done) {
        const { value, done: doneReading } = await reader.read()
        done = doneReading
        if (value) setAiResponse((prev) => prev + decoder.decode(value, { stream: true }))
      }
    } catch {
      setAiResponse('Error al contactar con la IA. Intenta de nuevo.')
    } finally {
      setIsAiLoading(false)
    }
  }

  useEffect(() => {
    if (!isDialogOpen || !currentSubject) return

    const loadEntries = async () => {
      setIsEntriesLoading(true)
      setEntriesError("")

      try {
        const params = new URLSearchParams({
          subjectId: currentSubject.id,
          sessionDate: currentDateKey,
          weekNumber: String(selectedWeekNumber),
        })

        const response = await fetch(`/api/subject-day-entries?${params.toString()}`)
        const payload = await response.json()
        if (!response.ok) {
          throw new Error(getErrorMessage(payload, "No se pudieron cargar las dudas del dia."))
        }

        setEntries(Array.isArray(payload) ? payload : [])
      } catch (error) {
        console.error("Failed to load subject day entries:", error)
        setEntries([])
        setEntriesError(error instanceof Error ? error.message : "No se pudieron cargar las dudas del dia.")
      } finally {
        setIsEntriesLoading(false)
      }
    }

    void loadEntries()
  }, [currentDateKey, currentSubject, isDialogOpen, selectedWeekNumber])

  useEffect(() => {
    return () => {
      if (reviewAudio) {
        URL.revokeObjectURL(reviewAudio.url)
      }

      Object.values(audioElementRefs.current).forEach((audioElement) => {
        audioElement?.pause()
      })

      if (mediaStreamRef.current) {
        mediaStreamRef.current.getTracks().forEach((track) => track.stop())
      }

      audioCacheRef.current.forEach((url) => URL.revokeObjectURL(url))
    }
  }, [reviewAudio])

  const disposeReviewAudio = (nextAudio?: ReviewAudio | null) => {
    if (reviewAudio && reviewAudio !== nextAudio) {
      URL.revokeObjectURL(reviewAudio.url)
    }
  }

  const resetSubjectUiState = () => {
    audioCacheRef.current.forEach((url) => URL.revokeObjectURL(url))
    audioCacheRef.current.clear()
    audioElementRefs.current = {}
    setEntries([])
    setEntriesError("")
    setRecordingError("")
    setEditingAnswerId(null)
    setEditingTitleId(null)
    setAnswerDrafts({})
    setQuestionDrafts({})
    setTitleDrafts({})
    setRevealedAnswers({})
    setIsSavingTitleId(null)
    setExpandedAudioEntryId(null)
    setLoadingAudioEntryId(null)
    setAudioSourceUrls({})
    setIsCopyingEntries(false)
    setIsLinkDialogOpen(false)
    setLinkEntryId(null)
    setLinkDraft({ label: "", url: "" })
    setIsSavingLink(false)
  }

  const cancelReview = () => {
    disposeReviewAudio(null)
    setReviewAudio(null)
    setIsReviewDialogOpen(false)
  }

  const closeSubjectDialog = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.onstop = null
      mediaRecorderRef.current.stop()
    }

    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((track) => track.stop())
      mediaStreamRef.current = null
    }

    Object.values(audioElementRefs.current).forEach((audioElement) => {
      audioElement?.pause()
    })
    setIsRecording(false)
    cancelReview()
    setIsDialogOpen(false)
    setCurrentSubject(null)
    resetSubjectUiState()
  }

  const handleSubjectClick = (subject: Subject) => {
    setCurrentSubject(subject)
    setCurrentDateKey(todayKey)
    resetSubjectUiState()
    setIsDialogOpen(true)
  }

  const markSubjectAsCompleted = (subject: Subject) => {
    if (!completedSubjects.some((item) => item.id === subject.id)) {
      const nextActive = activeSubjects.filter((item) => item.id !== subject.id)
      const nextCompleted = [...completedSubjects, subject]
      const nextHistory = history.slice(0, historyIndex + 1)
      nextHistory.push({ active: nextActive, completed: nextCompleted })

      setActiveSubjects(nextActive)
      setCompletedSubjects(nextCompleted)
      setHistory(nextHistory)
      setHistoryIndex(nextHistory.length - 1)
    }

    closeSubjectDialog()
  }

  const moveDay = (direction: -1 | 1) => {
    const nextIndex = currentDayIndex + direction
    if (nextIndex < 0 || nextIndex >= weekDates.length || nextIndex > lastVisibleDayIndex) return
    setCurrentDateKey(formatDateKey(weekDates[nextIndex]))
  }

  const startRecording = async () => {
    setRecordingError("")

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

        const chunks = recordingChunksRef.current
        recordingChunksRef.current = []

        if (mediaStreamRef.current) {
          mediaStreamRef.current.getTracks().forEach((track) => track.stop())
          mediaStreamRef.current = null
        }

        if (chunks.length === 0) return

        const blob = new Blob(chunks, { type: recorder.mimeType || "audio/webm" })
        const nextReviewAudio = {
          blob,
          mimeType: blob.type || "audio/webm",
          url: URL.createObjectURL(blob),
        }

        disposeReviewAudio(nextReviewAudio)
        setReviewAudio(nextReviewAudio)
        setIsReviewDialogOpen(true)
      }

      recorder.start()
      setIsRecording(true)
    } catch (error) {
      console.error("Failed to start recording:", error)
      setRecordingError(error instanceof Error ? error.message : "No se pudo iniciar la grabacion.")
      setIsRecording(false)
    }
  }

  const stopRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop()
    }
  }

  const confirmReview = async () => {
    if (!currentSubject || !reviewAudio) return

    setIsUploadingAudio(true)
    setEntriesError("")

    try {
      const formData = new FormData()
      formData.append("subjectId", currentSubject.id)
      formData.append("subjectName", getSubjectDisplayName(currentSubject))
      formData.append("sessionDate", currentDateKey)
      formData.append("weekNumber", String(selectedWeekNumber))
      formData.append("weekdayIndex", String(currentDayIndex >= 0 ? currentDayIndex : 0))
      formData.append("audio", new File([reviewAudio.blob], `${currentSubject.id}-${currentDateKey}.webm`, { type: reviewAudio.mimeType }))

      const response = await fetch("/api/subject-day-entries", {
        method: "POST",
        body: formData,
      })

      const payload = await response.json()
      if (!response.ok) {
        throw new Error(getErrorMessage(payload, "No se pudo confirmar el audio."))
      }

      setEntries((previousEntries) => {
        const nextEntries = [...previousEntries, payload as SubjectDayEntry]
        return nextEntries.sort((left, right) => left.order_index - right.order_index || left.id - right.id)
      })

      cancelReview()
    } catch (error) {
      console.error("Failed to upload audio entry:", error)
      setEntriesError(error instanceof Error ? error.message : "No se pudo confirmar el audio.")
    } finally {
      setIsUploadingAudio(false)
    }
  }

  const startAnswerEdit = (entry: SubjectDayEntry) => {
    setEditingAnswerId(entry.id)
    setAnswerDrafts((previous) => ({
      ...previous,
      [entry.id]: previous[entry.id] ?? entry.answer_text ?? "",
    }))
    setQuestionDrafts((previous) => ({
      ...previous,
      [entry.id]: previous[entry.id] ?? entry.transcript_text,
    }))
  }

  const saveAnswer = async (entry: SubjectDayEntry) => {
    const draft = (answerDrafts[entry.id] ?? entry.answer_text ?? "").trim()
    const questionDraft = (questionDrafts[entry.id] ?? entry.transcript_text).trim()
    setIsSavingAnswerId(entry.id)

    try {
      const response = await fetch(`/api/subject-day-entries/${entry.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answerText: draft || null, transcriptText: questionDraft || entry.transcript_text }),
      })

      const payload = await response.json()
      if (!response.ok) {
        throw new Error(getErrorMessage(payload, "No se pudo guardar la respuesta."))
      }

      setEntries((previousEntries) => previousEntries.map((item) => (item.id === entry.id ? (payload as SubjectDayEntry) : item)))
      setEditingAnswerId(null)
      setRevealedAnswers((previous) => ({ ...previous, [entry.id]: false }))
    } catch (error) {
      console.error("Failed to save answer:", error)
      setEntriesError(error instanceof Error ? error.message : "No se pudo guardar la respuesta.")
    } finally {
      setIsSavingAnswerId(null)
    }
  }

  const startTitleEdit = (entry: SubjectDayEntry) => {
    setEditingTitleId(entry.id)
    setTitleDrafts((previous) => ({
      ...previous,
      [entry.id]: previous[entry.id] ?? getEntryDisplayTitle(entry),
    }))
  }

  const saveTitle = async (entry: SubjectDayEntry) => {
    const draft = (titleDrafts[entry.id] ?? "").trim()
    setIsSavingTitleId(entry.id)

    try {
      const response = await fetch(`/api/subject-day-entries/${entry.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customTitle: draft || null }),
      })

      const payload = await response.json()
      if (!response.ok) {
        throw new Error(getErrorMessage(payload, "No se pudo guardar el nombre de la duda."))
      }

      setEntries((previousEntries) => previousEntries.map((item) => (item.id === entry.id ? (payload as SubjectDayEntry) : item)))
      setEditingTitleId(null)
    } catch (error) {
      console.error("Failed to save entry title:", error)
      setEntriesError(error instanceof Error ? error.message : "No se pudo guardar el nombre de la duda.")
    } finally {
      setIsSavingTitleId(null)
    }
  }

  const copyEntriesForDay = async () => {
    if (entries.length === 0 || isCopyingEntries) return

    setIsCopyingEntries(true)
    try {
      const payload = entries
        .map((entry) => `${getEntryDisplayTitle(entry)}: ${entry.answer_text?.trim() || ""}`)
        .join("\n")
      await navigator.clipboard.writeText(payload)
    } catch (error) {
      console.error("Failed to copy entries:", error)
      setEntriesError("No se pudieron copiar las dudas.")
    } finally {
      window.setTimeout(() => setIsCopyingEntries(false), 600)
    }
  }

  const openLinkDialog = (entryId: number) => {
    setLinkEntryId(entryId)
    setLinkDraft({ label: "", url: "" })
    setIsLinkDialogOpen(true)
  }

  const saveEntryLink = async () => {
    if (linkEntryId === null) return

    setIsSavingLink(true)
    try {
      const response = await fetch(`/api/subject-day-entries/${linkEntryId}/links`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          label: linkDraft.label.trim(),
          url: linkDraft.url.trim(),
        }),
      })

      const payload = await response.json()
      if (!response.ok) {
        throw new Error(getErrorMessage(payload, "No se pudo guardar el link."))
      }

      setEntries((previousEntries) =>
        previousEntries.map((entry) =>
          entry.id === linkEntryId
            ? {
                ...entry,
                external_links: [...entry.external_links, payload as SubjectDayEntryLink],
              }
            : entry
        )
      )
      setIsLinkDialogOpen(false)
      setLinkEntryId(null)
      setLinkDraft({ label: "", url: "" })
    } catch (error) {
      console.error("Failed to save entry link:", error)
      setEntriesError(error instanceof Error ? error.message : "No se pudo guardar el link.")
    } finally {
      setIsSavingLink(false)
    }
  }

  const togglePlayback = async (entryId: number) => {
    try {
      if (expandedAudioEntryId === entryId) {
        const currentAudio = audioElementRefs.current[entryId]
        if (currentAudio) {
          if (currentAudio.paused) {
            await currentAudio.play()
          } else {
            currentAudio.pause()
          }
        }
        return
      }

      Object.entries(audioElementRefs.current).forEach(([key, audioElement]) => {
        if (Number(key) !== entryId) {
          audioElement?.pause()
        }
      })

      let nextUrl = audioCacheRef.current.get(entryId)
      if (!nextUrl) {
        setLoadingAudioEntryId(entryId)
        const response = await fetch(`/api/subject-day-entries/${entryId}/audio`)
        if (!response.ok) {
          const payload = await parseJsonResponse(response)
          throw new Error(getErrorMessage(payload, "No se pudo descargar el audio."))
        }

        const blob = await response.blob()
        nextUrl = URL.createObjectURL(blob)
        audioCacheRef.current.set(entryId, nextUrl)
        setAudioSourceUrls((previous) => ({
          ...previous,
          [entryId]: nextUrl!,
        }))
      }

      setExpandedAudioEntryId(entryId)
      setTimeout(() => {
        const audioElement = audioElementRefs.current[entryId]
        if (audioElement) {
          void audioElement.play()
        }
      }, 0)
    } catch (error) {
      console.error("Failed to play remote audio:", error)
      setEntriesError("No se pudo reproducir el audio.")
    } finally {
      setLoadingAudioEntryId(null)
    }
  }

  // Practice modal functions
  const openPracticeModal = () => {
    setPracticeSubjectIndex(null)
    setPracticeSubjectId("")
    setPracticeWeekNumber(String(getCurrentWeekNumber()))
    setPracticeFilters({ random: false, unanswered: false, erre: false })
    setPracticeEntries([])
    setPracticeVisibleEntries([])
    setPracticeLoadError("")
    setCurrentPracticeIndex(0)
    setIsPracticeFinished(false)
    setIsAnswerRevealed(false)
    setIsPracticeOpen(true)
  }

  const loadPracticeEntries = async (subjectId: string, weekNumberValue = practiceWeekNumber, filters = practiceFilters) => {
    const subjectIndex = SUBJECT_ID_TO_INDEX[subjectId]
    if (subjectIndex === undefined) {
      setPracticeLoadError("La materia seleccionada no es valida.")
      setPracticeSubjectId("")
      setPracticeSubjectIndex(null)
      setPracticeEntries([])
      setPracticeVisibleEntries([])
      return
    }

    const parsedWeekNumber = Number.parseInt(weekNumberValue, 10)
    if (Number.isNaN(parsedWeekNumber) || parsedWeekNumber < 0) {
      setPracticeLoadError("La semana seleccionada no es valida.")
      setPracticeEntries([])
      setPracticeVisibleEntries([])
      return
    }

    setIsLoadingPractice(true)
    setPracticeLoadError("")
    setPracticeSubjectId(subjectId)
    setPracticeSubjectIndex(subjectIndex)
    setPracticeWeekNumber(String(parsedWeekNumber))
    setCurrentPracticeIndex(0)
    setIsPracticeFinished(false)
    setIsAnswerRevealed(false)
    try {
      const controller = new AbortController()
      const timeoutId = window.setTimeout(() => controller.abort(), 10000)
      let res: Response

      try {
        const params = new URLSearchParams({
          subjectId,
          weekNumber: String(parsedWeekNumber),
        })

        res = await fetch(`/api/subject-day-entries?${params.toString()}`, {
          signal: controller.signal,
        })
      } finally {
        window.clearTimeout(timeoutId)
      }

      const data = await parseJsonResponse(res)
      if (!res.ok) {
        throw new Error(getErrorMessage(data, "No se pudieron cargar las dudas de practica."))
      }

      const normalizedEntries = Array.isArray(data) ? (data as SubjectDayEntry[]) : []
      setPracticeEntries(normalizedEntries)
      setPracticeVisibleEntries(applyPracticeFilters(normalizedEntries, filters, { shuffle: true }))
    } catch (err) {
      console.error("[v0] Failed to load practice entries:", err)
      setPracticeEntries([])
      setPracticeVisibleEntries([])
      setPracticeLoadError(
        err instanceof Error ? err.message : "No se pudieron cargar las dudas de practica."
      )
    } finally {
      setIsLoadingPractice(false)
    }
  }

  const togglePracticeFilter = (key: keyof PracticeFilters) => {
    const nextFilters = {
      ...practiceFilters,
      [key]: !practiceFilters[key],
    }
    setPracticeFilters(nextFilters)
    setCurrentPracticeIndex(0)
    setIsPracticeFinished(false)
    setPracticeVisibleEntries(applyPracticeFilters(practiceEntries, nextFilters, { shuffle: true }))
  }

  const handlePracticeAnswer = async (estado: "bien" | "erre") => {
    const currentEntry = practiceVisibleEntries[currentPracticeIndex]
    if (!currentEntry) return

    const nextPracticeState = estado === "erre" ? "erre" : null
    const shouldRemainVisible =
      (!practiceFilters.erre || nextPracticeState === "erre") &&
      (!practiceFilters.unanswered || !currentEntry.answer_text?.trim())
    const nextVisibleLength = practiceVisibleEntries.length + (shouldRemainVisible ? 0 : -1)
    const nextIndex = shouldRemainVisible ? currentPracticeIndex + 1 : currentPracticeIndex

    setPracticeEntries((prev) =>
      prev.map((entry) =>
        entry.id === currentEntry.id
          ? { ...entry, practice_state: nextPracticeState }
          : entry
      )
    )
    setPracticeVisibleEntries((prev) => {
      const updatedVisibleEntries = prev.map((entry) =>
        entry.id === currentEntry.id
          ? { ...entry, practice_state: nextPracticeState }
          : entry
      )

      if (!shouldRemainVisible) {
        return updatedVisibleEntries.filter((entry) => entry.id !== currentEntry.id)
      }

      return updatedVisibleEntries
    })
    setIsAnswerRevealed(false)

    if (nextVisibleLength <= 0 || nextIndex >= nextVisibleLength) {
      setIsPracticeFinished(true)
    } else {
      setCurrentPracticeIndex(nextIndex)
    }

    void (async () => {
      try {
        const response = await fetch(`/api/subject-day-entries/${currentEntry.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ practiceState: nextPracticeState }),
        })
        const payload = await parseJsonResponse(response)
        if (!response.ok) {
          throw new Error(getErrorMessage(payload, "No se pudo actualizar el estado de practica."))
        }
      } catch (error) {
        console.error("[v0] Failed to update practice state:", error)
        setPracticeLoadError(error instanceof Error ? error.message : "No se pudo actualizar el estado.")
      }
    })()
  }

  const handleUndo = () => {
    if (historyIndex > 0) {
      const newIndex = historyIndex - 1
      const state = history[newIndex]
      setActiveSubjects(state.active)
      setCompletedSubjects(state.completed)
      setHistoryIndex(newIndex)
    }
  }

  const handleRedo = () => {
    if (historyIndex < history.length - 1) {
      const newIndex = historyIndex + 1
      const state = history[newIndex]
      setActiveSubjects(state.active)
      setCompletedSubjects(state.completed)
      setHistoryIndex(newIndex)
    }
  }

  const canUndo = historyIndex > 0
  const canRedo = historyIndex < history.length - 1
  const currentPracticeEntry = practiceVisibleEntries[currentPracticeIndex]
  const practiceWeekOptions = useMemo(
    () => Array.from({ length: getCurrentWeekNumber() + 1 }, (_, index) => String(index)),
    []
  )

  const handleReset = async () => {
    try {
      const date = getTodayDateString()
      
      // Reset local state
      setActiveSubjects(INITIAL_SUBJECTS)
      setCompletedSubjects([])
      setHistory([])
      setHistoryIndex(-1)

      // Delete today's session from database
      await fetch("/api/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          date,
          activeSubjectIds: INITIAL_SUBJECTS.map(s => s.id),
          completedSubjects: {},
        }),
      })
    } catch (error) {
      console.error("[v0] Failed to reset:", error)
    }
  }

  // Helper function to calculate optimal font size based on text length and segment width
  const calculateFontSize = (text: string, anglePerSegment: number) => {
    const baseSize = 14
    const textLength = text.split("\n").reduce((max, line) => Math.max(max, line.length), 0)
    
    // Adjust based on text length
    let fontSize = baseSize
    if (textLength > 15) fontSize = 11
    else if (textLength > 12) fontSize = 12
    else if (textLength > 10) fontSize = 13
    
    // Further adjust based on segment angle (narrower segments need smaller text)
    if (anglePerSegment < 60) fontSize = Math.max(10, fontSize - 2)
    else if (anglePerSegment < 75) fontSize = Math.max(11, fontSize - 1)
    
    return fontSize
  }

  const segments = useMemo(() => {
    if (activeSubjects.length === 0) return []
    const total = activeSubjects.length
    const radius = 140
    const centerX = 160
    const centerY = 160

    // Special case: single subject — render as a full circle
    if (total === 1) {
      const subject = activeSubjects[0]
      // Two-arc trick to draw a full circle
      const path = [
        `M ${centerX} ${centerY - radius}`,
        `A ${radius} ${radius} 0 1 1 ${centerX - 0.001} ${centerY - radius}`,
        "Z",
      ].join(" ")
      return [{ subject, path, labelX: centerX, labelY: centerY, fontSize: 14 }]
    }

    const anglePerSegment = 360 / total

    return activeSubjects.map((subject, index) => {
      const startAngle = index * anglePerSegment - 90
      const endAngle = (index + 1) * anglePerSegment - 90
      const startRad = (startAngle * Math.PI) / 180
      const endRad = (endAngle * Math.PI) / 180
      const x1 = centerX + radius * Math.cos(startRad)
      const y1 = centerY + radius * Math.sin(startRad)
      const x2 = centerX + radius * Math.cos(endRad)
      const y2 = centerY + radius * Math.sin(endRad)
      const largeArcFlag = anglePerSegment > 180 ? 1 : 0
      const path = `M ${centerX} ${centerY} L ${x1} ${y1} A ${radius} ${radius} 0 ${largeArcFlag} 1 ${x2} ${y2} Z`
      const midAngle = (((startAngle + endAngle) / 2) * Math.PI) / 180
      const labelRadius = radius * 0.65
      const labelX = centerX + labelRadius * Math.cos(midAngle)
      const labelY = centerY + labelRadius * Math.sin(midAngle)
      const fontSize = calculateFontSize(subject.name, anglePerSegment)

      return { subject, path, labelX, labelY, fontSize }
    })
  }, [activeSubjects])

  const editingEntry = useMemo(
    () => entries.find((entry) => entry.id === editingAnswerId) ?? null,
    [editingAnswerId, entries]
  )

  if (isLoading) {
    return (
      <div className="min-h-screen bg-slate-100 flex flex-col">
        <header className="flex items-center p-4 bg-white shadow-sm">
          <div className="flex gap-2">
            <div className="h-10 w-10 rounded-full border border-slate-300 bg-slate-50" />
            <div className="h-10 w-10 rounded-full border border-slate-300 bg-slate-50" />
          </div>
        </header>
        <main className="flex-1 flex items-center justify-center p-6">
          <div className="w-full max-w-sm aspect-square rounded-full bg-slate-200 animate-pulse" />
        </main>
        <footer className="p-3 text-center text-xs text-slate-400 bg-white border-t">
          Cargando...
        </footer>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-slate-100 flex flex-col">
      {/* Header */}
      <header className="flex items-center justify-between p-4 bg-white shadow-sm">
        <div />

        {/* Save status indicator */}
        <div className="flex items-center gap-1.5 text-xs">
          {saveStatus === "saving" && (
            <>
              <Loader2 className="w-3.5 h-3.5 text-slate-400 animate-spin" />
              <span className="text-slate-400">Guardando...</span>
            </>
          )}
          {saveStatus === "saved" && (
            <>
              <Check className="w-3.5 h-3.5 text-green-500" />
              <span className="text-green-500">Guardado</span>
            </>
          )}
          {saveStatus === "error" && (
            <span className="text-red-500">Error al guardar</span>
          )}
        </div>

        <div className="flex gap-2 items-center">
          <Button
            onClick={openPracticeModal}
            variant="outline"
            className="h-9 px-3"
          >
            <GraduationCap className="w-4 h-4 mr-1.5" />
            Practicar
          </Button>
          <button
            onClick={handleReset}
            className="p-2 rounded-full hover:bg-slate-100 transition-colors"
            aria-label="Reiniciar"
            title="Reiniciar todas las materias"
          >
            <RotateCcw className="w-5 h-5 text-slate-700" />
          </button>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 flex items-center justify-center p-6">
        {activeSubjects.length > 0 ? (
          <svg viewBox="0 0 320 320" className="w-full max-w-sm" style={{ maxWidth: "500px" }}>
            <g>
              {segments.map(({ subject, path, labelX, labelY, fontSize }) => (
              <g
                key={subject.id}
                onClick={() => handleSubjectClick(subject)}
                className="cursor-pointer"
                style={{ transformOrigin: "160px 160px" }}
              >
                <path
                  d={path}
                  fill={subject.color}
                  stroke="white"
                  strokeWidth="3"
                  className="transition-all duration-500 hover:brightness-110 active:brightness-90"
                />
                <text
                  x={labelX}
                  y={labelY}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  fill="white"
                  fontSize={fontSize}
                  fontWeight="700"
                  className="pointer-events-none select-none"
                >
                  {subject.name.split("\n").map((line, i, arr) => (
                    <tspan
                      key={i}
                      x={labelX}
                      dy={i === 0 ? -(arr.length - 1) * (fontSize * 0.5) : fontSize * 1.3}
                    >
                      {line}
                    </tspan>
                  ))}
                </text>
              </g>
            ))}
            </g>
          </svg>
        ) : (
          <div className="text-center">
            <h2 className="text-2xl font-bold text-slate-700 mb-2">¡Todo completado!</h2>
            <p className="text-slate-500">Todas las materias fueron vistas hoy</p>
          </div>
        )}
      </main>

      {/* Footer - Completed Subjects */}
      <footer className="p-4 text-center text-xs text-slate-600 bg-white border-t">
        {completedSubjects.length > 0 && (
          <div className="flex flex-wrap gap-2 justify-center mb-2">
            {completedSubjects.map((subject) => (
              <button
                key={subject.id}
                type="button"
                onClick={() => handleSubjectClick(subject)}
                className="px-3 py-1 rounded-full text-white text-xs font-medium transition-opacity hover:opacity-90"
                style={{ backgroundColor: subject.color }}
              >
                {subject.name.replace("\n", " ")}
              </button>
            ))}
          </div>
        )}
        <p>Las materias se reiniciarán mañana</p>
      </footer>

      {/* AI Modal */}
      <Dialog open={isAiOpen} onOpenChange={(open) => { if (!open) { setIsAiOpen(false); setAiSent(false); setAiResponse("") } }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-slate-600" />
              Consultar IA
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-3">
            {/* Prompt textarea — always visible */}
            {!aiSent && (
              <>
                <Textarea
                  placeholder="Escribe tu consulta para la IA..."
                  value={aiPrompt}
                  onChange={(e) => handleAiPromptChange(e.target.value)}
                  className="min-h-32 resize-none text-sm"
                  autoFocus
                />
                {completedSubjects.length > 0 && (
                  <p className="text-xs text-slate-400">
                    Se enviará el panorama de las materias completadas como contexto.
                  </p>
                )}
              </>
            )}

            {/* Streaming response */}
            {aiSent && (
              <div
                ref={aiResponseRef}
                className="min-h-32 max-h-80 overflow-y-auto rounded-md border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700 whitespace-pre-wrap leading-relaxed"
              >
                {isAiLoading && !aiResponse && (
                  <span className="flex items-center gap-2 text-slate-400">
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    Generando respuesta...
                  </span>
                )}
                {aiResponse}
                {isAiLoading && aiResponse && (
                  <span className="inline-block w-1.5 h-4 bg-slate-400 animate-pulse ml-0.5 align-middle" />
                )}
              </div>
            )}
          </div>

          <DialogFooter className="gap-2">
            {!aiSent ? (
              <>
                <Button variant="outline" onClick={() => { setIsAiOpen(false) }}>
                  Cancelar
                </Button>
                <Button
                  onClick={handleAiSubmit}
                  disabled={!aiPrompt.trim() || isAiLoading}
                  className="bg-slate-800 hover:bg-slate-700 text-white"
                >
                  Enviar
                </Button>
              </>
            ) : (
              <Button
                variant="outline"
                onClick={() => { setIsAiOpen(false); setAiSent(false); setAiResponse("") }}
                disabled={isAiLoading}
              >
                Cerrar
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={isDialogOpen} onOpenChange={(open) => (!open ? closeSubjectDialog() : undefined)}>
        <DialogContent className="h-[100dvh] w-screen max-w-none border-0 bg-white p-0 shadow-none sm:h-[96vh] sm:w-[98vw] sm:max-w-[98vw] sm:border-2 sm:border-black" showCloseButton={false}>
          <div className="relative flex h-full flex-col overflow-hidden px-4 py-4 sm:p-8">
            <Button
              variant="outline"
              size="icon"
              onClick={() => moveDay(-1)}
              disabled={currentDayIndex <= 0}
              className="absolute left-3 top-1/2 z-20 hidden h-12 w-12 -translate-y-1/2 rounded-full border-2 border-black bg-white text-black opacity-70 hover:opacity-100 disabled:opacity-25 md:flex"
            >
              <ChevronLeft className="h-5 w-5" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              onClick={() => moveDay(1)}
              disabled={currentDayIndex === -1 || currentDayIndex >= lastVisibleDayIndex}
              className="absolute right-3 top-1/2 z-20 hidden h-12 w-12 -translate-y-1/2 rounded-full border-2 border-black bg-white text-black opacity-70 hover:opacity-100 disabled:opacity-25 md:flex"
            >
              <ChevronRight className="h-5 w-5" />
            </Button>

            <DialogHeader className="space-y-3 border-b border-black pb-3 sm:border-b-2 sm:pb-4 sm:pr-28">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 space-y-1.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <DialogTitle className="text-left text-[clamp(1.55rem,4.8vw,2.3rem)] font-normal leading-tight text-black">
                      Semana {selectedWeekNumber} - {getSubjectDisplayName(currentSubject)} - {getWeekdayLabel(currentDateKey)}
                    </DialogTitle>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => void copyEntriesForDay()}
                      disabled={entries.length === 0 || isCopyingEntries}
                      className="h-9 border-black px-3 text-black"
                    >
                      {isCopyingEntries ? <Loader2 className="h-4 w-4 animate-spin" /> : <Copy className="h-4 w-4" />}
                      Copiar
                    </Button>
                  </div>
                  <DialogDescription className="text-left text-sm text-black sm:text-base">
                    Dudas
                  </DialogDescription>
                </div>

                <Button
                  type="button"
                  onClick={() => currentSubject && markSubjectAsCompleted(currentSubject)}
                  className="h-10 rounded-2xl border-2 border-black bg-white px-4 text-sm text-black hover:bg-slate-100 sm:h-11 sm:px-6"
                >
                  Terminar
                </Button>
              </div>

              <div className="flex items-center justify-between gap-3 md:justify-start md:gap-4">
                <div className="flex items-center gap-2 md:hidden">
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={() => moveDay(-1)}
                    disabled={currentDayIndex <= 0}
                    className="h-10 w-10 rounded-full border border-black bg-white text-black disabled:opacity-30"
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={() => moveDay(1)}
                    disabled={currentDayIndex === -1 || currentDayIndex >= lastVisibleDayIndex}
                    className="h-10 w-10 rounded-full border border-black bg-white text-black disabled:opacity-30"
                  >
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
                <div className="text-sm text-slate-700 sm:text-base">{currentDateKey}</div>
              </div>
            </DialogHeader>

            <div className="flex-1 overflow-y-auto py-4 pr-1 sm:py-6 sm:pl-14 sm:pr-14">
              {entriesError ? (
                <div className="mb-3 border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">{entriesError}</div>
              ) : null}

              {isEntriesLoading ? (
                <div className="flex min-h-56 items-center justify-center">
                  <Loader2 className="h-6 w-6 animate-spin text-slate-500" />
                </div>
              ) : entries.length > 0 ? (
                <div className="space-y-3 pb-24 sm:space-y-4 sm:pb-28">
                  {entries.map((entry) => {
                    const isRevealed = revealedAnswers[entry.id]
                    const isExpandedAudio = expandedAudioEntryId === entry.id
                    const audioSrc = audioSourceUrls[entry.id]
                    const isEditingTitle = editingTitleId === entry.id

                    return (
                      <article key={entry.id} className="border border-slate-300 px-3 py-3 sm:px-4">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0 space-y-1.5">
                            {isEditingTitle ? (
                              <div className="flex flex-wrap items-center gap-2">
                                <Input
                                  value={titleDrafts[entry.id] ?? ""}
                                  onChange={(event) =>
                                    setTitleDrafts((previous) => ({
                                      ...previous,
                                      [entry.id]: event.target.value,
                                    }))
                                  }
                                  className="h-9 max-w-xs"
                                />
                                <Button size="sm" onClick={() => void saveTitle(entry)} disabled={isSavingTitleId === entry.id}>
                                  {isSavingTitleId === entry.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                                  Guardar
                                </Button>
                                <Button size="sm" variant="outline" onClick={() => setEditingTitleId(null)}>
                                  <X className="h-4 w-4" />
                                  Cancelar
                                </Button>
                              </div>
                            ) : (
                              <div className="flex flex-wrap items-center gap-2">
                                <p className="text-xs font-medium text-black sm:text-sm">{getEntryDisplayTitle(entry)}</p>
                                <Button size="icon" variant="ghost" onClick={() => startTitleEdit(entry)} className="h-8 w-8">
                                  <Pencil className="h-4 w-4 text-slate-500" />
                                </Button>
                              </div>
                            )}
                            <div className="flex flex-wrap items-center gap-2">
                              {entry.external_links.map((link) => (
                                <Button key={link.id} type="button" variant="outline" className="h-8 border-black px-3 text-xs text-black" asChild>
                                  <a href={link.url} target="_blank" rel="noreferrer">
                                    <Link2 className="h-3.5 w-3.5" />
                                    {link.label}
                                  </a>
                                </Button>
                              ))}
                              <Button
                                type="button"
                                variant="outline"
                                size="icon"
                                onClick={() => openLinkDialog(entry.id)}
                                className="h-8 w-8 border-black text-black"
                              >
                                <Plus className="h-4 w-4" />
                              </Button>
                            </div>
                            <p className="text-sm leading-6 text-slate-800 sm:text-base sm:leading-7">{entry.transcript_text}</p>
                          </div>

                          <Button variant="outline" onClick={() => void togglePlayback(entry.id)} className="h-10 shrink-0 border-black px-3 text-black sm:px-4">
                            {loadingAudioEntryId === entry.id ? <Loader2 className="h-4 w-4 animate-spin" /> : isExpandedAudio ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                            {loadingAudioEntryId === entry.id ? "Cargando..." : isExpandedAudio ? "Reproducir/Pausar" : "Audio"}
                          </Button>
                        </div>

                        {isExpandedAudio && audioSrc ? (
                          <div className="mt-3 space-y-2">
                            <audio
                              ref={(element) => {
                                audioElementRefs.current[entry.id] = element
                              }}
                              controls
                              src={audioSrc}
                              preload="metadata"
                              className="h-10 w-full sm:h-11"
                            />
                            <p className="text-xs text-slate-400">
                              El audio se descarga una sola vez y luego queda en memoria mientras el modal siga abierto.
                            </p>
                          </div>
                        ) : null}

                        <div className="mt-4 border-t border-slate-200 pt-3">
                          {entry.answer_text ? (
                            <div className="space-y-2.5">
                              <button
                                type="button"
                                onClick={() =>
                                  setRevealedAnswers((previous) => ({
                                    ...previous,
                                    [entry.id]: !previous[entry.id],
                                  }))
                                }
                                className="block w-full border border-slate-300 px-3 py-2 text-left text-sm text-slate-800"
                              >
                                {isRevealed ? entry.answer_text : "Click para revelar la respuesta"}
                              </button>
                              <Button variant="outline" onClick={() => startAnswerEdit(entry)} className="h-10 px-3">
                                Responder
                              </Button>
                            </div>
                          ) : (
                            <Button variant="outline" onClick={() => startAnswerEdit(entry)} className="h-10 px-3">
                              Responder
                            </Button>
                          )}
                        </div>
                      </article>
                    )
                  })}
                </div>
              ) : (
                <div className="pb-24 text-sm text-slate-700 sm:pb-28">Todavia no hay dudas cargadas para este dia.</div>
              )}

              {recordingError ? (
                <div className="mt-3 pr-24 text-sm text-red-700">{recordingError}</div>
              ) : null}
              {isRecording ? (
                <div className="mt-3 pr-24 text-sm text-slate-700">Grabando...</div>
              ) : null}
            </div>

            <div className="relative h-0">
              <button
                type="button"
                onClick={() => void (isRecording ? stopRecording() : startRecording())}
                className={`absolute bottom-4 right-2 flex h-16 w-16 items-center justify-center rounded-full border-2 border-black shadow-sm sm:right-4 sm:h-20 sm:w-20 ${
                  isRecording ? "bg-red-500 text-white" : "bg-white text-black"
                }`}
                aria-label={isRecording ? "Detener grabacion" : "Iniciar grabacion"}
              >
                {isRecording ? <Square className="h-8 w-8 sm:h-10 sm:w-10" /> : <Mic className="h-8 w-8 sm:h-10 sm:w-10" />}
              </button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(editingEntry)} onOpenChange={(open) => (!open ? setEditingAnswerId(null) : undefined)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Responder</DialogTitle>
            <DialogDescription>Escribe la respuesta para esta duda. Luego quedara oculta hasta hacer click.</DialogDescription>
          </DialogHeader>

          {editingEntry ? (
            <div className="space-y-4">
              <div className="space-y-2">
                <p className="text-sm font-medium text-slate-700">Pregunta</p>
                <Textarea
                  value={questionDrafts[editingEntry.id] ?? editingEntry.transcript_text}
                  onChange={(event) =>
                    setQuestionDrafts((previous) => ({
                      ...previous,
                      [editingEntry.id]: event.target.value,
                    }))
                  }
                  placeholder="Escribe la duda"
                  className="min-h-24"
                />
              </div>
              <div className="space-y-2">
                <p className="text-sm font-medium text-slate-700">Respuesta</p>
              <Textarea
                value={answerDrafts[editingEntry.id] ?? ""}
                onChange={(event) =>
                  setAnswerDrafts((previous) => ({
                    ...previous,
                    [editingEntry.id]: event.target.value,
                  }))
                }
                placeholder="Escribe la respuesta"
                className="min-h-32"
              />
              </div>
            </div>
          ) : null}

          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingAnswerId(null)}>
              Cancelar
            </Button>
            <Button onClick={() => editingEntry && void saveAnswer(editingEntry)} disabled={!editingEntry || isSavingAnswerId === editingEntry.id}>
              {editingEntry && isSavingAnswerId === editingEntry.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
              Guardar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={isReviewDialogOpen} onOpenChange={(open) => (!open ? cancelReview() : undefined)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Revisar audio</DialogTitle>
            <DialogDescription>Escuchalo antes de confirmar. Solo al confirmar se crea la transcripcion.</DialogDescription>
          </DialogHeader>

          {reviewAudio ? (
            <div className="space-y-3">
              <audio controls src={reviewAudio.url} className="w-full" />
              <p className="text-sm text-slate-500">
                {getSubjectDisplayName(currentSubject)} - {getWeekdayLabel(currentDateKey)} - {currentDateKey}
              </p>
            </div>
          ) : null}

          <DialogFooter>
            <Button variant="outline" onClick={cancelReview} disabled={isUploadingAudio}>
              Cancelar
            </Button>
            <Button onClick={() => void confirmReview()} disabled={!reviewAudio || isUploadingAudio}>
              {isUploadingAudio ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
              Confirmar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={isLinkDialogOpen} onOpenChange={setIsLinkDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Agregar link</DialogTitle>
            <DialogDescription>Este link queda guardado en la duda seleccionada.</DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium text-slate-700">Ingresa nombre</label>
              <Input
                value={linkDraft.label}
                onChange={(event) => setLinkDraft((previous) => ({ ...previous, label: event.target.value }))}
                placeholder="Apunte, video, PDF..."
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-slate-700">Insertar link</label>
              <Input
                type="url"
                value={linkDraft.url}
                onChange={(event) => setLinkDraft((previous) => ({ ...previous, url: event.target.value }))}
                placeholder="https://..."
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setIsLinkDialogOpen(false)} disabled={isSavingLink}>
              Cancelar
            </Button>
            <Button onClick={() => void saveEntryLink()} disabled={isSavingLink || !linkDraft.label.trim() || !linkDraft.url.trim()}>
              {isSavingLink ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
              Guardar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Practice Modal */}
      <Dialog open={isPracticeOpen} onOpenChange={setIsPracticeOpen}>
        <DialogContent className="flex h-[100dvh] w-screen max-w-none flex-col overflow-hidden rounded-none border-0 p-0 sm:max-w-none">
          <DialogHeader className="border-b border-slate-200 bg-gradient-to-r from-slate-50 via-white to-sky-50 px-6 py-5 sm:px-8">
            <DialogTitle className="flex items-center gap-2">
              <GraduationCap className="h-5 w-5 text-slate-600" />
              Practicar
            </DialogTitle>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto bg-slate-50/60 px-6 py-6 sm:px-8">
            {/* Subject selection */}
            {practiceSubjectIndex === null && (
              <div className="mx-auto flex h-full w-full max-w-5xl flex-col justify-center gap-8">
                <div className="space-y-2">
                  <p className="text-sm font-medium uppercase tracking-[0.24em] text-slate-400">Modo practica</p>
                  <h2 className="text-3xl font-semibold text-slate-800 sm:text-4xl">
                    Elegi materia y como queres practicar
                  </h2>
                  <p className="max-w-2xl text-sm text-slate-500 sm:text-base">
                    Se cargan todas las dudas de la semana elegida para la materia seleccionada.
                  </p>
                </div>
                <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                  <div className="space-y-3 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
                    <p className="text-xs font-medium uppercase tracking-[0.22em] text-slate-400">Materia</p>
                    <Select value={practiceSubjectId} onValueChange={(value) => setPracticeSubjectId(value)}>
                      <SelectTrigger className="h-14 text-base">
                        <SelectValue placeholder="Seleccionar materia..." />
                      </SelectTrigger>
                      <SelectContent>
                        {INITIAL_SUBJECTS.map((s) => (
                          <SelectItem key={s.id} value={s.id}>
                            {s.name.replace("\n", " ")}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-3 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
                    <p className="text-xs font-medium uppercase tracking-[0.22em] text-slate-400">Semana</p>
                    <Select value={practiceWeekNumber} onValueChange={setPracticeWeekNumber}>
                      <SelectTrigger className="h-14 text-base">
                        <SelectValue placeholder="Seleccionar semana..." />
                      </SelectTrigger>
                      <SelectContent>
                        {practiceWeekOptions.map((weekValue) => (
                          <SelectItem key={weekValue} value={weekValue}>
                            Semana {weekValue}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-3 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm lg:col-span-2">
                    <p className="text-xs font-medium uppercase tracking-[0.22em] text-slate-400">Filtros</p>
                    <div className="grid gap-3 sm:grid-cols-3">
                      <div
                        role="button"
                        tabIndex={0}
                        onClick={() => togglePracticeFilter("random")}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault()
                            togglePracticeFilter("random")
                          }
                        }}
                        className={`flex cursor-pointer items-start gap-3 rounded-2xl border p-4 text-left transition ${
                          practiceFilters.random
                            ? "border-sky-500 bg-sky-50 shadow-sm"
                            : "border-slate-200 bg-slate-50 hover:border-slate-300 hover:bg-white"
                        }`}
                      >
                        <Checkbox checked={practiceFilters.random} className="mt-0.5 pointer-events-none" />
                        <span className="space-y-1">
                          <span className="block text-sm font-semibold text-slate-700">Aleatorio</span>
                          <span className="block text-xs text-slate-500">Mezcla el orden de las dudas cargadas.</span>
                        </span>
                      </div>
                      <div
                        role="button"
                        tabIndex={0}
                        onClick={() => togglePracticeFilter("unanswered")}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault()
                            togglePracticeFilter("unanswered")
                          }
                        }}
                        className={`flex cursor-pointer items-start gap-3 rounded-2xl border p-4 text-left transition ${
                          practiceFilters.unanswered
                            ? "border-amber-500 bg-amber-50 shadow-sm"
                            : "border-slate-200 bg-slate-50 hover:border-slate-300 hover:bg-white"
                        }`}
                      >
                        <Checkbox checked={practiceFilters.unanswered} className="mt-0.5 pointer-events-none" />
                        <span className="space-y-1">
                          <span className="block text-sm font-semibold text-slate-700">Sin respuesta</span>
                          <span className="block text-xs text-slate-500">Solo dudas que aun no tienen respuesta.</span>
                        </span>
                      </div>
                      <div
                        role="button"
                        tabIndex={0}
                        onClick={() => togglePracticeFilter("erre")}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault()
                            togglePracticeFilter("erre")
                          }
                        }}
                        className={`flex cursor-pointer items-start gap-3 rounded-2xl border p-4 text-left transition ${
                          practiceFilters.erre
                            ? "border-rose-500 bg-rose-50 shadow-sm"
                            : "border-slate-200 bg-slate-50 hover:border-slate-300 hover:bg-white"
                        }`}
                      >
                        <Checkbox checked={practiceFilters.erre} className="mt-0.5 pointer-events-none" />
                        <span className="space-y-1">
                          <span className="block text-sm font-semibold text-slate-700">Erre</span>
                          <span className="block text-xs text-slate-500">Solo dudas marcadas como erre.</span>
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
                <div className="flex justify-end">
                  <Button
                    onClick={() => practiceSubjectId && practiceWeekNumber && void loadPracticeEntries(practiceSubjectId, practiceWeekNumber, practiceFilters)}
                    disabled={!practiceSubjectId || !practiceWeekNumber}
                    className="h-12 px-6"
                  >
                    Cargar dudas
                  </Button>
                </div>
              </div>
            )}

            {/* Loading state */}
            {practiceSubjectIndex !== null && isLoadingPractice && (
              <div className="flex h-full items-center justify-center py-10">
                <Loader2 className="h-8 w-8 animate-spin text-slate-400" />
              </div>
            )}

            {/* No questions */}
            {practiceSubjectIndex !== null && !isLoadingPractice && practiceVisibleEntries.length === 0 && (
              <div className="mx-auto flex h-full w-full max-w-3xl items-center justify-center">
                <div className="w-full rounded-3xl border border-slate-200 bg-white px-6 py-10 text-center shadow-sm">
                  <p className="mb-4 text-sm text-slate-500 sm:text-base">
                    {practiceLoadError || "No hay dudas para esta materia con los filtros elegidos."}
                  </p>
                  <Button
                    variant="outline"
                    onClick={() => {
                      setPracticeSubjectId("")
                      setPracticeSubjectIndex(null)
                      setPracticeEntries([])
                      setPracticeVisibleEntries([])
                    }}
                  >
                    Elegir otra materia
                  </Button>
                </div>
              </div>
            )}

            {/* Flashcard view */}
            {practiceSubjectIndex !== null && !isLoadingPractice && practiceVisibleEntries.length > 0 && (
              <div className="mx-auto flex h-full w-full max-w-6xl flex-col">
                {!isPracticeFinished && currentPracticeIndex < practiceVisibleEntries.length ? (
                  <div className="flex flex-1 flex-col gap-5">
                    <div className="flex flex-col gap-2 rounded-3xl border border-slate-200 bg-white px-5 py-4 shadow-sm sm:flex-row sm:items-center sm:justify-between">
                      <p className="text-sm text-slate-500">
                        Duda {currentPracticeIndex + 1} de {practiceVisibleEntries.length}
                      </p>
                      <Button
                        variant="outline"
                        onClick={() => {
                          setPracticeSubjectId("")
                          setPracticeSubjectIndex(null)
                          setCurrentPracticeIndex(0)
                          setIsPracticeFinished(false)
                          setIsAnswerRevealed(false)
                          setPracticeEntries([])
                          setPracticeVisibleEntries([])
                        }}
                      >
                        Cambiar materia
                      </Button>
                    </div>

                    <div className="flex flex-1 items-center justify-center">
                      <div className="w-full max-w-4xl rounded-[2rem] border border-slate-200 bg-white p-6 shadow-sm sm:p-8 lg:p-10">
                        <div className="space-y-8">
                          <div className="space-y-3">
                            <p className="text-xs font-medium uppercase tracking-[0.22em] text-slate-400">Pregunta</p>
                            <p className="text-sm font-medium text-slate-500">{getEntryDisplayTitle(currentPracticeEntry!)}</p>
                            <p className="text-xl font-semibold leading-relaxed text-slate-800 sm:text-2xl">
                              {currentPracticeEntry?.transcript_text}
                            </p>
                          </div>

                          <div className="rounded-3xl border border-dashed border-slate-200 bg-slate-50 p-5 sm:p-6">
                            <div className="flex items-start justify-between gap-3">
                              <div className="flex-1 space-y-3">
                                <p className="text-xs font-medium uppercase tracking-[0.22em] text-slate-400">Respuesta</p>
                                <p
                                  role="button"
                                  tabIndex={0}
                                  onClick={() => setIsAnswerRevealed((prev) => !prev)}
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter" || e.key === " ") {
                                      e.preventDefault()
                                      setIsAnswerRevealed((prev) => !prev)
                                    }
                                  }}
                                  className="cursor-pointer text-base leading-relaxed text-slate-600 hover:text-slate-800 sm:text-lg"
                                >
                                  {isAnswerRevealed
                                    ? currentPracticeEntry?.answer_text || "Sin respuesta registrada"
                                    : "Click para mostrar"}
                                </p>
                              </div>
                            </div>
                          </div>

                          {isAnswerRevealed && (
                            <div className="grid gap-3 sm:grid-cols-2">
                              <Button
                                className="h-12 bg-green-600 text-base text-white hover:bg-green-700"
                                onClick={() => handlePracticeAnswer("bien")}
                              >
                                <Check className="mr-2 h-4 w-4" />
                                Bien
                              </Button>
                              <Button
                                className="h-12 bg-red-500 text-base text-white hover:bg-red-600"
                                onClick={() => handlePracticeAnswer("erre")}
                              >
                                Erre
                              </Button>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-1 items-center justify-center">
                    <div className="w-full max-w-3xl rounded-[2rem] border border-slate-200 bg-gradient-to-br from-emerald-50 via-sky-50 to-white px-6 py-10 text-center shadow-sm">
                      <p className="mb-2 text-3xl font-semibold text-slate-700">Terminaste</p>
                      <p className="mb-2 text-sm text-slate-500">
                        Cerralo un momento, respira hondo y afloja los hombros.
                      </p>
                      <p className="mb-6 text-sm text-slate-500">
                        Totales visibles: {practiceVisibleEntries.length}. Erre visibles:{" "}
                        {practiceVisibleEntries.filter((entry) => entry.practice_state === "erre").length}
                      </p>
                      <div className="flex flex-wrap justify-center gap-2">
                        <Button
                          variant="outline"
                          onClick={() => {
                            setCurrentPracticeIndex(0)
                            setIsPracticeFinished(false)
                            setIsAnswerRevealed(false)
                            setPracticeVisibleEntries((prev) => (practiceFilters.random ? shuffleQuestions(prev) : [...prev]))
                          }}
                        >
                          Repetir
                        </Button>
                        <Button
                          variant="outline"
                          onClick={() => {
                            setPracticeSubjectId("")
                            setPracticeSubjectIndex(null)
                            setCurrentPracticeIndex(0)
                            setIsPracticeFinished(false)
                            setIsAnswerRevealed(false)
                            setPracticeEntries([])
                            setPracticeVisibleEntries([])
                          }}
                        >
                          Otra materia
                        </Button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}

          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

