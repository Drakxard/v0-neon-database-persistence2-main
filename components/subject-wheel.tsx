"use client"

import { useState, useMemo, useEffect, useRef, useCallback, useTransition } from "react"
import { ChevronLeft, ChevronRight, RotateCcw, Check, Loader2, Sparkles, GraduationCap, Pencil, X, Info, Download, Link2, Upload } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Input } from "@/components/ui/input"
import { saveQuestionExampleAction } from "@/app/actions/question-example"
import { toast } from "@/hooks/use-toast"

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

function idsToSubjects(ids: string[]): Subject[] {
  return ids.map((id) => INITIAL_SUBJECTS.find((s) => s.id === id)).filter(Boolean) as Subject[]
}

function subjectsToIds(subjects: Subject[]): string[] {
  return subjects.map((s) => s.id)
}

type SaveStatus = "idle" | "saving" | "saved" | "error"

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

  // Subject modal state (multi-step: panorama -> questions -> confirm)
  const [isDialogOpen, setIsDialogOpen] = useState(false)
  const [currentSubject, setCurrentSubject] = useState<Subject | null>(null)
  const [panorama, setPanorama] = useState("")
  const [isSavingPanorama, setIsSavingPanorama] = useState(false)
  const [subjectSaveError, setSubjectSaveError] = useState("")
  const [modalStep, setModalStep] = useState<"panorama" | "questions">("panorama")
  
  // Questions draft state for subject modal
  const [questionDrafts, setQuestionDrafts] = useState<QuestionDraft[]>([
    { pregunta: "", respuesta: "" },
  ])

  // Practice modal state
  const [isPracticeOpen, setIsPracticeOpen] = useState(false)
  const [practiceSubjectIndex, setPracticeSubjectIndex] = useState<number | null>(null)
  const [practiceQuestions, setPracticeQuestions] = useState<Question[]>([])
  const [currentPracticeIndex, setCurrentPracticeIndex] = useState(0)
  const [isAnswerRevealed, setIsAnswerRevealed] = useState(false)
  const [isLoadingPractice, setIsLoadingPractice] = useState(false)
  const [practiceLoadError, setPracticeLoadError] = useState("")
  const [editingPracticeQuestionId, setEditingPracticeQuestionId] = useState<number | null>(null)
  const [practiceEditDraft, setPracticeEditDraft] = useState<QuestionDraft>({ pregunta: "", respuesta: "" })
  const [isExampleModalOpen, setIsExampleModalOpen] = useState(false)
  const [exampleLinkDraft, setExampleLinkDraft] = useState("")
  const [exampleImageFile, setExampleImageFile] = useState<File | null>(null)
  const [exampleError, setExampleError] = useState("")
  const [isSavingExample, startSavingExample] = useTransition()
  const currentPracticeQuestionId = practiceQuestions[currentPracticeIndex]?.id ?? null

  // AI modal state
  const [isAiOpen, setIsAiOpen] = useState(false)
  const [aiPrompt, setAiPrompt] = useState("")
  const [aiResponse, setAiResponse] = useState("")
  const [isAiLoading, setIsAiLoading] = useState(false)
  const [aiSent, setAiSent] = useState(false)
  const aiResponseRef = useRef<HTMLDivElement>(null)
  // Panoramas indexed by subject id for the AI context
  const [panoramaMap, setPanoramaMap] = useState<Record<string, string>>({})

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

  const resetQuestionDrafts = () => {
    setQuestionDrafts([
      { pregunta: "", respuesta: "" },
    ])
  }

  const handleUpdateQuestionDraft = (index: number, field: "pregunta" | "respuesta", value: string) => {
    setQuestionDrafts((prev) =>
      prev.map((draft, i) => (i === index ? { ...draft, [field]: value } : draft))
    )
  }

  const handleSubjectClick = async (subject: Subject) => {
    const date = getTodayDateString()

    // Reset modal state
    setCurrentSubject(subject)
    setModalStep("panorama")
    resetQuestionDrafts()
    
    // Try to load previous panorama if it exists
    try {
      const response = await fetch(`/api/subject-completions?date=${date}&subjectId=${subject.id}`)
      const completion = await response.json()
      setPanorama(completion?.panorama || "")
    } catch (error) {
      console.error("Failed to load panorama:", error)
      setPanorama("")
    }

    setIsDialogOpen(true)
    setSubjectSaveError("")
  }

  // Continue from panorama to questions step
  const handleContinueToQuestions = () => {
    if (!currentSubject) return
    setSubjectSaveError("")
    setModalStep("questions")
  }

  // Final confirm: save panorama and mark as completed
  const handleConfirmSubject = async () => {
    if (!currentSubject) return

    setIsSavingPanorama(true)
    setSubjectSaveError("")
    try {
      const date = getTodayDateString()

      // Save panorama to database
      const completionResponse = await fetch("/api/subject-completions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          date,
          subjectId: currentSubject.id,
          panorama,
        }),
      })

      if (!completionResponse.ok) {
        const payload = await parseJsonResponse(completionResponse)
        throw new Error(getErrorMessage(payload, "No se pudo guardar el panorama."))
      }

      const idMateria = SUBJECT_ID_TO_INDEX[currentSubject.id]
      const semana = getCurrentWeekNumber()
      const questionItems = questionDrafts
        .map((item) => ({
          pregunta: item.pregunta.trim(),
          respuesta: item.respuesta.trim(),
        }))
        .filter((item) => item.pregunta.length > 0)

      if (questionItems.length > 0) {
        const questionsResponse = await fetch("/api/questions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id_materia: idMateria,
            semana,
            items: questionItems,
          }),
        })

        if (!questionsResponse.ok) {
          const payload = await parseJsonResponse(questionsResponse)
          throw new Error(getErrorMessage(payload, "No se pudieron guardar las preguntas."))
        }
      }

      // Check if subject is already completed
      const isAlreadyCompleted = completedSubjects.some((s) => s.id === currentSubject.id)

      if (!isAlreadyCompleted) {
        // Update local state - mark as completed
        const newActive = activeSubjects.filter((s) => s.id !== currentSubject.id)
        const newCompleted = [...completedSubjects, currentSubject]

        setActiveSubjects(newActive)
        setCompletedSubjects(newCompleted)

        // Add to history
        const newHistory = history.slice(0, historyIndex + 1)
        newHistory.push({
          active: newActive,
          completed: newCompleted,
        })
        setHistory(newHistory)
        setHistoryIndex(newHistory.length - 1)
      }
      // If already completed, just updating panorama - no state change needed

      setIsDialogOpen(false)
      setCurrentSubject(null)
      setPanorama("")
      setModalStep("panorama")
      resetQuestionDrafts()
    } catch (error) {
      console.error("Failed to save panorama:", error)
      const message = error instanceof Error ? error.message : "No se pudo guardar esta materia."
      setSubjectSaveError(message)
      toast({
        variant: "destructive",
        title: "No se pudo confirmar",
        description: message,
      })
    } finally {
      setIsSavingPanorama(false)
    }
  }

  // Practice modal functions
  const openPracticeModal = () => {
    setPracticeSubjectIndex(null)
    setPracticeQuestions([])
    setPracticeLoadError("")
    setCurrentPracticeIndex(0)
    setIsAnswerRevealed(false)
    setEditingPracticeQuestionId(null)
    setPracticeEditDraft({ pregunta: "", respuesta: "" })
    setIsPracticeOpen(true)
  }

  const loadPracticeQuestions = async (subjectId: string) => {
    const subjectIndex = SUBJECT_ID_TO_INDEX[subjectId]
    if (subjectIndex === undefined) {
      setPracticeLoadError("La materia seleccionada no es valida.")
      setPracticeSubjectIndex(null)
      setPracticeQuestions([])
      return
    }

    setIsLoadingPractice(true)
    setPracticeLoadError("")
    setPracticeSubjectIndex(subjectIndex)
    setCurrentPracticeIndex(0)
    setIsAnswerRevealed(false)
    setEditingPracticeQuestionId(null)
    setPracticeEditDraft({ pregunta: "", respuesta: "" })
    try {
      const semana = getCurrentWeekNumber()
      console.log("[v0] Loading practice questions for:", { subjectIndex, semana })
      const controller = new AbortController()
      const timeoutId = window.setTimeout(() => controller.abort(), 10000)
      let res: Response

      try {
        res = await fetch(`/api/questions?id_materia=${subjectIndex}&semana=${semana}`, {
          signal: controller.signal,
        })
      } finally {
        window.clearTimeout(timeoutId)
      }

      const data = await parseJsonResponse(res)
      if (!res.ok) {
        throw new Error(getErrorMessage(data, "No se pudieron cargar las preguntas."))
      }

      console.log("[v0] Practice questions loaded:", data)
      setPracticeQuestions(Array.isArray(data) ? data : [])
    } catch (err) {
      console.error("[v0] Failed to load practice questions:", err)
      setPracticeQuestions([])
      setPracticeLoadError(
        err instanceof Error ? err.message : "No se pudieron cargar las preguntas de practica."
      )
    } finally {
      setIsLoadingPractice(false)
    }
  }

  const handlePracticeAnswer = async (estado: "bien" | "erre") => {
    const currentQuestion = practiceQuestions[currentPracticeIndex]
    if (!currentQuestion) return

    // Update estado in DB
    try {
      await fetch("/api/questions", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: currentQuestion.id, estado }),
      })
    } catch {
      // ignore
    }

    // Update local state
    setPracticeQuestions((prev) =>
      prev.map((q) => (q.id === currentQuestion.id ? { ...q, estado } : q))
    )

    // Move to next question or finish
    if (currentPracticeIndex < practiceQuestions.length - 1) {
      setCurrentPracticeIndex((prev) => prev + 1)
      setIsAnswerRevealed(false)
    } else {
      setCurrentPracticeIndex((prev) => prev + 1)
      setIsAnswerRevealed(false)
    }
  }

  const startEditingPracticeQuestion = () => {
    const currentQuestion = practiceQuestions[currentPracticeIndex]
    if (!currentQuestion) return

    setEditingPracticeQuestionId(currentQuestion.id)
    setPracticeEditDraft({
      pregunta: currentQuestion.pregunta,
      respuesta: currentQuestion.respuesta,
    })
  }

  const cancelEditingPracticeQuestion = () => {
    setEditingPracticeQuestionId(null)
    setPracticeEditDraft({ pregunta: "", respuesta: "" })
  }

  const savePracticeQuestionEdit = async () => {
    const currentQuestion = practiceQuestions[currentPracticeIndex]
    if (!currentQuestion || editingPracticeQuestionId !== currentQuestion.id) return

    const pregunta = practiceEditDraft.pregunta.trim()
    const respuesta = practiceEditDraft.respuesta.trim()

    try {
      if (!pregunta || !respuesta) {
        const response = await fetch(`/api/questions?id=${currentQuestion.id}`, {
          method: "DELETE",
        })

        if (!response.ok) {
          const payload = await parseJsonResponse(response)
          throw new Error(getErrorMessage(payload, "No se pudo borrar la pregunta."))
        }

        const nextQuestions = practiceQuestions.filter((question) => question.id !== currentQuestion.id)
        setPracticeQuestions(nextQuestions)
        setCurrentPracticeIndex((prev) => Math.min(prev, Math.max(nextQuestions.length - 1, 0)))
        setIsAnswerRevealed(false)
      } else {
        const response = await fetch("/api/questions", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id: currentQuestion.id,
            pregunta,
            respuesta,
          }),
        })

        const payload = await parseJsonResponse(response)
        if (!response.ok) {
          throw new Error(getErrorMessage(payload, "No se pudo actualizar la pregunta."))
        }

        setPracticeQuestions((prev) =>
          prev.map((question) =>
            question.id === currentQuestion.id ? { ...question, pregunta, respuesta } : question
          )
        )
      }

      cancelEditingPracticeQuestion()
    } catch (error) {
      console.error("[v0] Failed to edit practice question:", error)
    }
  }

  const saveQuestionExample = async () => {
    const currentQuestion = practiceQuestions[currentPracticeIndex]
    if (!currentQuestion) return

    const hasExistingExample = Boolean(currentQuestion.example_image_url || currentQuestion.example_link)
    if (!exampleImageFile && !exampleLinkDraft.trim() && !hasExistingExample) {
      return
    }

    setExampleError("")
    startSavingExample(async () => {
      const formData = new FormData()
      formData.append("questionId", String(currentQuestion.id))
      formData.append("exampleLink", exampleLinkDraft.trim())

      if (exampleImageFile) {
        formData.append("image", exampleImageFile)
      }

      const result = await saveQuestionExampleAction(formData)
      if (!result.ok) {
        setExampleError(result.error)
        return
      }

      setPracticeQuestions((prev) =>
        prev.map((question) =>
          question.id === currentQuestion.id
            ? {
                ...question,
                example_image_url: result.question.example_image_url ?? question.example_image_url,
                example_link: result.question.example_link ?? question.example_link,
              }
            : question
        )
      )
      setExampleImageFile(null)
    })
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
  const currentPracticeQuestion = practiceQuestions[currentPracticeIndex]

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
        <div className="flex gap-2">
          <button
            onClick={handleUndo}
            disabled={!canUndo}
            className="p-2 rounded-full hover:bg-slate-100 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            aria-label="Deshacer"
          >
            <ChevronLeft className="w-5 h-5 text-slate-700" />
          </button>
          <button
            onClick={handleRedo}
            disabled={!canRedo}
            className="p-2 rounded-full hover:bg-slate-100 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            aria-label="Rehacer"
          >
            <ChevronRight className="w-5 h-5 text-slate-700" />
          </button>
        </div>

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
            onClick={openAiModal}
            className="p-2 rounded-full hover:bg-slate-100 transition-colors"
            aria-label="Consultar IA"
            title="Consultar IA (G)"
          >
            <Sparkles className="w-5 h-5 text-slate-700" />
          </button>
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
              <div
                key={subject.id}
                className="px-3 py-1 rounded-full text-white text-xs font-medium"
                style={{ backgroundColor: subject.color }}
              >
                {subject.name.replace("\n", " ")}
              </div>
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

      {/* Multi-step Subject Modal: Panorama -> Questions -> Confirm */}
      <Dialog open={isDialogOpen} onOpenChange={(open) => {
        if (!open) {
          setIsDialogOpen(false)
          setCurrentSubject(null)
          setPanorama("")
          setModalStep("panorama")
          resetQuestionDrafts()
        }
      }}>
        <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle>
              {modalStep === "panorama" 
                ? `Panorama de ${currentSubject?.name.replace("\n", " ")}`
                : "Preguntas"}
            </DialogTitle>
          </DialogHeader>

          {/* Step 1: Panorama */}
          {modalStep === "panorama" && (
            <div className="space-y-4 flex-1 overflow-y-auto">
              <Textarea
                placeholder="Describe lo que aprendiste en esta materia hoy..."
                value={panorama}
                onChange={(e) => setPanorama(e.target.value)}
                className="min-h-40 resize-none"
              />
            </div>
          )}

          {/* Step 2: Questions */}
          {modalStep === "questions" && (
            <div className="flex-1 overflow-y-auto">
              <div className="relative overflow-hidden rounded-2xl border border-slate-200/80 bg-gradient-to-br from-white via-slate-50 to-sky-50 shadow-[0_18px_45px_-28px_rgba(15,23,42,0.35)]">
                <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-cyan-500 via-sky-500 to-indigo-500" />
                <div className="space-y-6 p-5 md:p-6">
                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="rounded-2xl border border-slate-200 bg-white/90 p-4 shadow-sm">
                      <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">
                        Pregunta
                      </label>
                      <Textarea
                        value={questionDrafts[0]?.pregunta ?? ""}
                        onChange={(e) => handleUpdateQuestionDraft(0, "pregunta", e.target.value)}
                        placeholder=""
                        className="min-h-36 resize-none rounded-xl border-slate-200 bg-slate-50/80 text-sm text-slate-800 shadow-none focus-visible:border-sky-400 focus-visible:ring-sky-200"
                      />
                    </div>

                    <div className="rounded-2xl border border-slate-200 bg-white/90 p-4 shadow-sm">
                      <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">
                        Respuesta
                      </label>
                      <Textarea
                        value={questionDrafts[0]?.respuesta ?? ""}
                        onChange={(e) => handleUpdateQuestionDraft(0, "respuesta", e.target.value)}
                        placeholder=""
                        className="min-h-36 resize-none rounded-xl border-slate-200 bg-slate-50/80 text-sm text-slate-800 shadow-none focus-visible:border-sky-400 focus-visible:ring-sky-200"
                      />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          <DialogFooter className="gap-2 mt-4">
            {modalStep === "panorama" ? (
              <>
                <Button
                  variant="outline"
                  onClick={() => {
                    setIsDialogOpen(false)
                    setCurrentSubject(null)
                    setPanorama("")
                    setModalStep("panorama")
                    resetQuestionDrafts()
                  }}
                >
                  Cancelar
                </Button>
                <Button
                  onClick={handleContinueToQuestions}
                  type="button"
                  className="bg-slate-800 hover:bg-slate-700 text-white"
                >
                  Continuar
                </Button>
              </>
            ) : (
              <>
                <Button
                  variant="outline"
                  type="button"
                  onClick={() => setModalStep("panorama")}
                >
                  Volver
                </Button>
                <Button
                  onClick={handleConfirmSubject}
                  type="button"
                  disabled={isSavingPanorama}
                  className="bg-blue-600 hover:bg-blue-700 text-white"
                >
                  {isSavingPanorama ? "Guardando..." : "Confirmar"}
                </Button>
              </>
            )}
          </DialogFooter>
          {subjectSaveError ? (
            <p className="mt-2 text-sm text-red-500">{subjectSaveError}</p>
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog open={isExampleModalOpen} onOpenChange={setIsExampleModalOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Ejemplo</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            {currentPracticeQuestion?.example_image_url ? (
              <div className="space-y-2">
                <p className="text-sm font-medium text-slate-700">Descarga Ejemplo</p>
                <a
                  href={currentPracticeQuestion.example_image_url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800"
                >
                  <Download className="h-4 w-4" />
                  Descargar ejemplo
                </a>
              </div>
            ) : null}

            <div className="space-y-2">
              <label className="text-xs font-medium uppercase tracking-wide text-slate-400">
                Imagen
              </label>
              <Input
                type="file"
                accept="image/*"
                onChange={(e) => setExampleImageFile(e.target.files?.[0] ?? null)}
                className="bg-white"
              />
            </div>

            <div className="space-y-2">
              <label className="text-xs font-medium uppercase tracking-wide text-slate-400">
                Link
              </label>
              {currentPracticeQuestion?.example_link ? (
                <a
                  href={currentPracticeQuestion.example_link}
                  target="_blank"
                  rel="noreferrer"
                  className="block break-all rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-sky-700 underline underline-offset-4"
                >
                  {currentPracticeQuestion.example_link}
                </a>
              ) : null}
              <div className="relative">
                <Link2 className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <Input
                  type="url"
                  value={exampleLinkDraft}
                  onChange={(e) => setExampleLinkDraft(e.target.value)}
                  placeholder="https://..."
                  className="bg-white pl-9"
                />
              </div>
            </div>

            {exampleError ? (
              <p className="text-sm text-red-500">{exampleError}</p>
            ) : null}
          </div>

          <DialogFooter className="gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setIsExampleModalOpen(false)}
            >
              Cerrar
            </Button>
            <Button
              type="button"
              onClick={saveQuestionExample}
              disabled={isSavingExample || (!exampleImageFile && !exampleLinkDraft.trim())}
              className="bg-sky-600 text-white hover:bg-sky-700"
            >
              {isSavingExample ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Upload className="h-4 w-4" />
              )}
              Guardar ejemplo
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Practice Modal */}
      <Dialog open={isPracticeOpen} onOpenChange={setIsPracticeOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <GraduationCap className="w-4 h-4 text-slate-600" />
              Practicar
            </DialogTitle>
          </DialogHeader>

          {/* Subject selection */}
          {practiceSubjectIndex === null && (
            <div className="space-y-3">
              <p className="text-sm text-slate-500">Selecciona una materia para practicar:</p>
              <Select onValueChange={loadPracticeQuestions}>
                <SelectTrigger>
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
          )}

          {/* Loading state */}
          {practiceSubjectIndex !== null && isLoadingPractice && (
            <div className="flex items-center justify-center py-10">
              <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
            </div>
          )}

          {/* No questions */}
          {practiceSubjectIndex !== null && !isLoadingPractice && practiceQuestions.length === 0 && (
            <div className="text-center py-8">
              <p className="text-slate-500 text-sm mb-4">
                {practiceLoadError || "No hay preguntas para esta materia esta semana."}
              </p>
              <Button variant="outline" onClick={() => setPracticeSubjectIndex(null)}>
                Elegir otra materia
              </Button>
            </div>
          )}

          {/* Flashcard view */}
          {practiceSubjectIndex !== null && !isLoadingPractice && practiceQuestions.length > 0 && (
            <div className="space-y-4">
              {currentPracticeIndex < practiceQuestions.length ? (
                <>
                  {/* Progress */}
                  <div className="text-xs text-slate-400 text-center">
                    Pregunta {currentPracticeIndex + 1} de {practiceQuestions.length}
                  </div>

                  {/* Question card */}
                  <div className="p-4 bg-slate-50 rounded-lg border min-h-32">
                    {currentPracticeQuestion && editingPracticeQuestionId === currentPracticeQuestion.id ? (
                      <div className="space-y-3">
                        <div className="space-y-1">
                          <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Pregunta</p>
                          <Textarea
                            value={practiceEditDraft.pregunta}
                            onChange={(e) =>
                              setPracticeEditDraft((prev) => ({ ...prev, pregunta: e.target.value }))
                            }
                            className="min-h-20 bg-white"
                          />
                        </div>
                        <div className="space-y-1">
                          <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Respuesta</p>
                          <Textarea
                            value={practiceEditDraft.respuesta}
                            onChange={(e) =>
                              setPracticeEditDraft((prev) => ({ ...prev, respuesta: e.target.value }))
                            }
                            className="min-h-20 bg-white"
                          />
                        </div>
                        <p className="text-xs text-slate-400">
                          Si vacias la pregunta o la respuesta, la tarjeta se borra.
                        </p>
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            className="bg-slate-800 hover:bg-slate-700 text-white"
                            onClick={savePracticeQuestionEdit}
                          >
                            <Check className="w-4 h-4 mr-1" />
                            Guardar
                          </Button>
                          <Button size="sm" variant="outline" onClick={cancelEditingPracticeQuestion}>
                            <X className="w-4 h-4 mr-1" />
                            Cancelar
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex-1">
                            <p className="text-xs font-medium uppercase tracking-wide text-slate-400 mb-1">Pregunta</p>
                            <p className="font-medium text-slate-700 mb-3">
                              {currentPracticeQuestion?.pregunta}
                            </p>
                          </div>
                          <div className="flex items-center gap-1">
                            <Button
                              size="icon"
                              variant="ghost"
                              onClick={() => setIsExampleModalOpen(true)}
                              className="rounded-full"
                              aria-label="Ver ejemplo de la pregunta"
                            >
                              <Info className="w-4 h-4 text-slate-500" />
                            </Button>
                            <Button size="icon" variant="ghost" onClick={startEditingPracticeQuestion}>
                              <Pencil className="w-4 h-4 text-slate-500" />
                            </Button>
                          </div>
                        </div>

                        <div className="mt-2 pt-2 border-t">
                          <div className="flex items-start justify-between gap-3">
                            <div className="flex-1">
                              <p className="text-xs font-medium uppercase tracking-wide text-slate-400 mb-1">Respuesta</p>
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
                                className="text-sm text-slate-600 cursor-pointer hover:text-slate-800"
                              >
                                {isAnswerRevealed
                                  ? currentPracticeQuestion?.respuesta || "Sin respuesta registrada"
                                  : "Click para mostrar"}
                              </p>
                            </div>
                            <Button size="icon" variant="ghost" onClick={startEditingPracticeQuestion}>
                              <Pencil className="w-4 h-4 text-slate-500" />
                            </Button>
                          </div>
                        </div>
                      </>
                    )}
                  </div>

                  {/* Bien / Erré buttons - only visible when answer is revealed */}
                  {isAnswerRevealed && editingPracticeQuestionId === null && (
                    <div className="flex gap-3">
                      <Button
                        className="flex-1 bg-green-600 hover:bg-green-700 text-white"
                        onClick={() => handlePracticeAnswer("bien")}
                      >
                        <Check className="w-4 h-4 mr-1" />
                        Bien
                      </Button>
                      <Button
                        className="flex-1 bg-red-500 hover:bg-red-600 text-white"
                        onClick={() => handlePracticeAnswer("erre")}
                      >
                        Erré
                      </Button>
                    </div>
                  )}
                </>
              ) : (
                /* Summary after all questions */
                <div className="text-center py-6 px-4 rounded-xl border bg-gradient-to-br from-emerald-50 via-sky-50 to-white">
                  <p className="text-2xl font-semibold text-slate-700 mb-2">Terminaste!!</p>
                  <p className="text-sm text-slate-500 mb-2">
                    Cerralo un momento, respira hondo y afloja los hombros.
                  </p>
                  <p className="text-sm text-slate-500 mb-4">
                    Bien: {practiceQuestions.filter((q) => q.estado === "bien").length} | 
                    Erré: {practiceQuestions.filter((q) => q.estado === "erre").length}
                  </p>
                  <div className="flex gap-2 justify-center">
                    <Button variant="outline" onClick={() => {
                      setCurrentPracticeIndex(0)
                      setIsAnswerRevealed(false)
                      setEditingPracticeQuestionId(null)
                      setPracticeEditDraft({ pregunta: "", respuesta: "" })
                    }}>
                      Repetir
                    </Button>
                    <Button variant="outline" onClick={() => {
                      setPracticeSubjectIndex(null)
                      setCurrentPracticeIndex(0)
                      setIsAnswerRevealed(false)
                      setEditingPracticeQuestionId(null)
                      setPracticeEditDraft({ pregunta: "", respuesta: "" })
                    }}>
                      Otra materia
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setIsPracticeOpen(false)}>
              Cerrar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
