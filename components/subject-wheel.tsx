"use client"

import { useState, useMemo, useEffect, useRef, useCallback } from "react"
import { useRouter } from "next/navigation"
import { ChevronLeft, ChevronRight, RotateCcw, Check, Copy, ExternalLink, FilePenLine, Loader2, Plus, Sparkles, GraduationCap, Pencil, X, Link2, Mic, Pause, Play, Square, Smartphone } from "lucide-react"
import { AdminAccessModal } from "@/components/admin-access-modal"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { toast } from "@/hooks/use-toast"
import type { AuthSession } from "@/lib/authz"
import { uploadBlobToStorage, type DriveUploadSessionResponse } from "@/lib/client-storage-upload"
import { SUBJECTS, SUBJECT_ID_TO_INDEX } from "@/lib/subjects"
import { formatDateKey, getCurrentWeekNumber, getWeekDates, getWeekNumberForDate, getWeekdayLabel, parseDateKey } from "@/lib/subject-utils"

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
  subject_day_material_id: number | null
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
  is_featured: boolean
  external_links: SubjectDayEntryLink[]
  created_at: string
  updated_at: string
}

type SubjectDayMaterialType = "theory" | "practice"

interface SubjectDayMaterial {
  id: number
  subject_id: string
  week_number: number
  session_date: string
  weekday_index: number
  material_type: SubjectDayMaterialType
  order_index: number
  file_name: string
  drive_file_id: string
  drive_mime_type: string
  drive_web_view_link: string
  is_checkup_done: boolean
  created_at: string
  updated_at: string
}

interface PendingSubjectDayMaterial extends SubjectDayMaterial {
  is_pending_upload: true
}

function buildPracticeDraftViewerHref(params: {
  subjectId: string
  subjectName: string
  sessionDate: string
  weekNumber: number
  weekdayIndex: number
}) {
  const searchParams = new URLSearchParams({
    subjectId: params.subjectId,
    subjectName: params.subjectName,
    sessionDate: params.sessionDate,
    weekNumber: String(params.weekNumber),
    weekdayIndex: String(params.weekdayIndex),
    materialType: "practice",
  })

  return `/practice/viewer?${searchParams.toString()}`
}

function buildPracticeMaterialViewerHref(materialId: number) {
  const searchParams = new URLSearchParams({
    materialId: String(materialId),
  })

  return `/practice/viewer?${searchParams.toString()}`
}

function buildPracticeDefaultViewerHref(materialId: number) {
  const fileParam = encodeURIComponent(`/api/subject-day-materials/${materialId}/file`)
  return `/pdfjs/web/viewer.html?file=${fileParam}#locale=es-AR`
}

interface ReviewAudio {
  blob: Blob
  url: string
  mimeType: string
}

type AudioUploadTarget = {
  source: "subject-dialog" | "mobile-shortcut" | "manual-mobile-shortcut" | "continue-practice" | "continue-context"
  subjectId: string
  subjectName: string
  sessionDate: string
  weekNumber: number
  weekdayIndex: number
  materialId?: number | null
  shortcutIndex?: number
}

type ManualEntryTarget = {
  subjectId: string
  sessionDate: string
  weekNumber: number
  weekdayIndex: number
  materialId?: number | null
}

type MobileShortcutWindow = {
  index: number
  weekdayIndex: number
  startMinutes: number
  endMinutes: number
  subjectId: string
}

type PendingFeaturedUpdate = {
  entryId: number
  isFeatured: boolean
}

type ContinuePayload = {
  material: SubjectDayMaterial | null
  previousFeaturedEntry: SubjectDayEntry | null
}

type SubjectVisibilityState = {
  activeSubjects: Subject[]
  completedSubjects: Subject[]
}

type SubjectHistoryState = SubjectVisibilityState & {
  allCompletedIds: string[]
}

const MOBILE_SHORTCUT_WINDOWS: MobileShortcutWindow[] = [
  { index: 1, weekdayIndex: 0, startMinutes: 11 * 60, endMinutes: 12 * 60, subjectId: "fisica" },
  { index: 2, weekdayIndex: 0, startMinutes: 17 * 60, endMinutes: 18 * 60, subjectId: "calculo3" },
  { index: 3, weekdayIndex: 1, startMinutes: 16 * 60, endMinutes: 17 * 60, subjectId: "probabilidad" },
  { index: 4, weekdayIndex: 2, startMinutes: 14 * 60, endMinutes: 14 * 60 + 30, subjectId: "fisica" },
  { index: 5, weekdayIndex: 2, startMinutes: 18 * 60, endMinutes: 19 * 60, subjectId: "probabilidad" },
  { index: 6, weekdayIndex: 3, startMinutes: 11 * 60, endMinutes: 12 * 60, subjectId: "calculo3" },
  { index: 7, weekdayIndex: 4, startMinutes: 16 * 60, endMinutes: 17 * 60, subjectId: "logica" },
]

const SUBJECT_IDS_BY_WEEKDAY: Record<number, string[]> = {
  0: ["fisica", "calculo3"],
  1: ["logica", "probabilidad"],
  2: ["logica", "fisica", "probabilidad"],
  3: ["calculo3", "algebra"],
  4: ["fisica", "logica"],
  5: ["fisica", "calculo2", "probabilidad", "logica"],
  6: ["logica", "probabilidad", "calculo3", "fisica", "calculo2", "algebra"],
}

function getTodayDateString() {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`
}

function getMinutesOfDay(date: Date) {
  return date.getHours() * 60 + date.getMinutes()
}

function getSubjectById(subjectId: string, subjects: Subject[]) {
  return subjects.find((subject) => subject.id === subjectId) || null
}

function getScheduledSubjectIdsForDate(date: Date) {
  const jsDay = date.getDay()
  const weekdayIndex = jsDay === 0 ? 6 : jsDay - 1
  return SUBJECT_IDS_BY_WEEKDAY[weekdayIndex] ?? []
}

function getDisplaySubjectIdsForDate(date: Date, showAllSubjects: boolean, visibleSubjectIds: string[]) {
  const scheduledSubjectIds = getScheduledSubjectIdsForDate(date).filter((subjectId) => visibleSubjectIds.includes(subjectId))
  return showAllSubjects ? visibleSubjectIds : scheduledSubjectIds
}

function getDisplaySubjectsForDate(date: Date, showAllSubjects: boolean, subjects: Subject[]) {
  const visibleSubjectIds = subjects.map((subject) => subject.id)
  return getDisplaySubjectIdsForDate(date, showAllSubjects, visibleSubjectIds)
    .map((subjectId) => getSubjectById(subjectId, subjects))
    .filter(Boolean) as Subject[]
}

function getActiveMobileShortcutWindow(date: Date, visibleSubjectIds: string[]) {
  const jsDay = date.getDay()
  const weekdayIndex = jsDay === 0 ? 6 : jsDay - 1
  const currentMinutes = getMinutesOfDay(date)

  return (
    MOBILE_SHORTCUT_WINDOWS.find(
      (window) =>
        window.weekdayIndex === weekdayIndex &&
        visibleSubjectIds.includes(window.subjectId) &&
        currentMinutes >= window.startMinutes &&
        currentMinutes < window.endMinutes
    ) || null
  )
}

function getShortcutDismissKey(dateKey: string, shortcutIndex: number) {
  return `mobile-shortcut-dismissed:${dateKey}:${shortcutIndex}`
}

function formatClockTime(date: Date) {
  return new Intl.DateTimeFormat("es-AR", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date)
}

function formatMinutesLabel(totalMinutes: number) {
  const hours = String(Math.floor(totalMinutes / 60)).padStart(2, "0")
  const minutes = String(totalMinutes % 60).padStart(2, "0")
  return `${hours}:${minutes}`
}

function getRecorderMimeType() {
  if (typeof window === "undefined" || typeof MediaRecorder === "undefined") return ""

  const mimeTypes = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"]
  return mimeTypes.find((mimeType) => MediaRecorder.isTypeSupported(mimeType)) || ""
}

function getSubjectDisplayName(subject: Subject | null) {
  return subject?.name.replace("\n", " ") || ""
}

function idsToSubjects(ids: string[], subjects: Subject[]): Subject[] {
  return ids.map((id) => subjects.find((subject) => subject.id === id)).filter(Boolean) as Subject[]
}

function subjectsToIds(subjects: Subject[]): string[] {
  return subjects.map((s) => s.id)
}

function normalizeSubjectsForDay(completedIds: string[], date: Date, showAllSubjects: boolean, subjects: Subject[]): SubjectVisibilityState {
  const displayIds = getDisplaySubjectIdsForDate(date, showAllSubjects, subjects.map((subject) => subject.id))
  const completedSet = new Set(completedIds.filter((id) => displayIds.includes(id)))

  const completedSubjects = displayIds
    .filter((id) => completedSet.has(id))
    .map((id) => getSubjectById(id, subjects))
    .filter(Boolean) as Subject[]

  const activeSubjects = displayIds
    .filter((id) => !completedSet.has(id))
    .map((id) => getSubjectById(id, subjects))
    .filter(Boolean) as Subject[]

  return { activeSubjects, completedSubjects }
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

async function requireOkJson(response: Response, fallback: string) {
  const payload = await parseJsonResponse(response)
  if (!response.ok) {
    throw new Error(getErrorMessage(payload, fallback))
  }

  return payload
}

function mergeSubjectDayMaterials(...materialGroups: SubjectDayMaterial[][]) {
  const materialMap = new Map<string, SubjectDayMaterial>()

  for (const group of materialGroups) {
    for (const material of group) {
      materialMap.set(String(material.id), material)
    }
  }

  return sortSubjectDayMaterials(Array.from(materialMap.values()))
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

function entryHasAudio(entry: Pick<SubjectDayEntry, "drive_file_id" | "drive_mime_type">) {
  return entry.drive_file_id.trim().length > 0 && entry.drive_mime_type.startsWith("audio/")
}

function applyPracticeFilters(entries: SubjectDayEntry[], filters: PracticeFilters, options?: { shuffle?: boolean }) {
  const filteredEntries = entries.filter((entry) => {
    if (filters.unanswered && entry.answer_text?.trim()) return false
    if (filters.erre && entry.practice_state !== "erre") return false
    return true
  })

  return options?.shuffle && filters.random ? shuffleQuestions(filteredEntries) : filteredEntries
}

function sortSubjectDayEntries(entries: SubjectDayEntry[]) {
  return [...entries].sort(
    (left, right) =>
      Number(right.is_featured) - Number(left.is_featured) ||
      left.order_index - right.order_index ||
      left.id - right.id
  )
}

function sortSubjectDayMaterials(materials: SubjectDayMaterial[]) {
  return [...materials].sort((left, right) => {
    const sessionDateComparison = left.session_date.localeCompare(right.session_date)
    if (sessionDateComparison !== 0) {
      return sessionDateComparison
    }

    if (left.material_type !== right.material_type) {
      return left.material_type.localeCompare(right.material_type)
    }

    return left.order_index - right.order_index || left.id - right.id
  })
}

function getNextUncheckedPracticeMaterial(
  materials: SubjectDayMaterial[],
  {
    subjectId,
    sessionDate,
    weekNumber,
  }: {
    subjectId: string
    sessionDate: string
    weekNumber: number
  }
) {
  return sortSubjectDayMaterials(
    materials.filter(
      (material) =>
        material.material_type === "practice" &&
        material.subject_id === subjectId &&
        material.session_date === sessionDate &&
        material.week_number === weekNumber &&
        !material.is_checkup_done
    )
  )[0] ?? null
}

export function SubjectWheel({ authSession }: { authSession: AuthSession }) {
  const router = useRouter()
  const visibleSubjects = useMemo<Subject[]>(
    () => SUBJECTS.filter((subject) => authSession.isAdmin || authSession.allowedSubjectIds.includes(subject.id)),
    [authSession.allowedSubjectIds, authSession.isAdmin]
  )
  const visibleSubjectIds = useMemo(() => visibleSubjects.map((subject) => subject.id), [visibleSubjects])
  const [activeSubjects, setActiveSubjects] = useState<Subject[]>(() => getDisplaySubjectsForDate(parseDateKey(getTodayDateString()), false, visibleSubjects))
  const [completedSubjects, setCompletedSubjects] = useState<Subject[]>([])
  const [history, setHistory] = useState<SubjectHistoryState[]>([])
  const [historyIndex, setHistoryIndex] = useState(-1)
  const [isLoading, setIsLoading] = useState(true)
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle")

  // This ref is only flipped to true AFTER the initial load sets state,
  // so the sync useEffect never fires on the first render with stale default state.
  const readyToSync = useRef(false)

  const [isDialogOpen, setIsDialogOpen] = useState(false)
  const [isNextWeekDialogOpen, setIsNextWeekDialogOpen] = useState(false)
  const [currentSubject, setCurrentSubject] = useState<Subject | null>(null)
  const [currentDateKey, setCurrentDateKey] = useState(getTodayDateString())
  const [showAllSubjectsForDay, setShowAllSubjectsForDay] = useState(false)
  const [allCompletedSubjectIds, setAllCompletedSubjectIds] = useState<string[]>([])
  const [entries, setEntries] = useState<SubjectDayEntry[]>([])
  const [materials, setMaterials] = useState<SubjectDayMaterial[]>([])
  const [pendingMaterials, setPendingMaterials] = useState<PendingSubjectDayMaterial[]>([])
  const [isEntriesLoading, setIsEntriesLoading] = useState(false)
  const [isMaterialsLoading, setIsMaterialsLoading] = useState(false)
  const [entriesError, setEntriesError] = useState("")
  const [isRecording, setIsRecording] = useState(false)
  const [recordingError, setRecordingError] = useState("")
  const [reviewAudio, setReviewAudio] = useState<ReviewAudio | null>(null)
  const [recordingTarget, setRecordingTarget] = useState<AudioUploadTarget | null>(null)
  const [isReviewDialogOpen, setIsReviewDialogOpen] = useState(false)
  const [isUploadingAudio, setIsUploadingAudio] = useState(false)
  const [now, setNow] = useState(() => new Date())
  const [isMobileShortcutPickerOpen, setIsMobileShortcutPickerOpen] = useState(false)
  const [isMobileShortcutOpen, setIsMobileShortcutOpen] = useState(false)
  const [manualMobileSubjectId, setManualMobileSubjectId] = useState("")
  const [editingAnswerId, setEditingAnswerId] = useState<number | null>(null)
  const [manualEntryTarget, setManualEntryTarget] = useState<ManualEntryTarget | null>(null)
  const [manualQuestionDraft, setManualQuestionDraft] = useState("")
  const [manualAnswerDraft, setManualAnswerDraft] = useState("")
  const [answerDrafts, setAnswerDrafts] = useState<Record<number, string>>({})
  const [questionDrafts, setQuestionDrafts] = useState<Record<number, string>>({})
  const [editingTitleId, setEditingTitleId] = useState<number | null>(null)
  const [titleDrafts, setTitleDrafts] = useState<Record<number, string>>({})
  const [revealedAnswers, setRevealedAnswers] = useState<Record<number, boolean>>({})
  const [isDeletingEntryId, setIsDeletingEntryId] = useState<number | null>(null)
  const [isSavingAnswerId, setIsSavingAnswerId] = useState<number | null>(null)
  const [isSavingTitleId, setIsSavingTitleId] = useState<number | null>(null)
  const [expandedAudioEntryId, setExpandedAudioEntryId] = useState<number | null>(null)
  const [loadingAudioEntryId, setLoadingAudioEntryId] = useState<number | null>(null)
  const [audioSourceUrls, setAudioSourceUrls] = useState<Record<number, string>>({})
  const [isCopyingEntries, setIsCopyingEntries] = useState(false)
  const [practiceSectionView, setPracticeSectionView] = useState<"theory" | "exercises">("theory")
  const [exerciseWeeklyScopeEnabled, setExerciseWeeklyScopeEnabled] = useState(false)
  const [subjectViewDateOverride, setSubjectViewDateOverride] = useState<string | null>(null)
  const [selectedPracticeMaterialId, setSelectedPracticeMaterialId] = useState<number | null>(null)
  const [isUploadingMaterialType, setIsUploadingMaterialType] = useState<SubjectDayMaterialType | null>(null)
  const [isDeletingMaterialId, setIsDeletingMaterialId] = useState<number | null>(null)
  const [isLinkDialogOpen, setIsLinkDialogOpen] = useState(false)
  const [linkEntryId, setLinkEntryId] = useState<number | null>(null)
  const [linkDraft, setLinkDraft] = useState({ label: "", url: "" })
  const [isSavingLink, setIsSavingLink] = useState(false)
  const [isContinueOpen, setIsContinueOpen] = useState(false)
  const [isContinueLoading, setIsContinueLoading] = useState(false)
  const [continueError, setContinueError] = useState("")
  const [isAdminModalOpen, setIsAdminModalOpen] = useState(false)
  const prefetchPracticeViewer = useCallback(
    (material: SubjectDayMaterial) => {
      const href = buildPracticeDefaultViewerHref(material.id)
      router.prefetch(href)
    },
    [router]
  )
  const [continuePayload, setContinuePayload] = useState<ContinuePayload | null>(null)
  const theoryFileInputRef = useRef<HTMLInputElement | null>(null)
  const practiceFileInputRef = useRef<HTMLInputElement | null>(null)

  // Practice modal state
  const [isPracticeOpen, setIsPracticeOpen] = useState(false)
  const [practiceLaunchView, setPracticeLaunchView] = useState<"menu" | "theory" | "exercises">("menu")
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
  const [isReviewOpen, setIsReviewOpen] = useState(false)
  const [reviewSubjectId, setReviewSubjectId] = useState("")
  const [reviewEntries, setReviewEntries] = useState<SubjectDayEntry[]>([])
  const [isLoadingReview, setIsLoadingReview] = useState(false)
  const [reviewError, setReviewError] = useState("")
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
  const pendingMaterialCheckupTimersRef = useRef<Map<number, number>>(new Map())
  const pendingFeaturedUpdateRef = useRef<PendingFeaturedUpdate | null>(null)
  const pendingFeaturedSaveTimerRef = useRef<number | null>(null)
  const todayKey = getTodayDateString()
  const currentCalendarWeek = useMemo(() => getCurrentWeekNumber(now), [now])
  const activeMobileShortcut = useMemo(() => getActiveMobileShortcutWindow(now, visibleSubjectIds), [now, visibleSubjectIds])
  const mobileShortcutTarget = useMemo(() => {
    if (!activeMobileShortcut) return null

    const subject = getSubjectById(activeMobileShortcut.subjectId, visibleSubjects)
    if (!subject) return null

    const sessionDate = formatDateKey(now)
    return {
      source: "mobile-shortcut" as const,
      subjectId: subject.id,
      subjectName: getSubjectDisplayName(subject),
      sessionDate,
      weekNumber: getWeekNumberForDate(now),
      weekdayIndex: activeMobileShortcut.weekdayIndex,
      shortcutIndex: activeMobileShortcut.index,
    }
  }, [activeMobileShortcut, now, visibleSubjects])
  const manualMobileShortcutTarget = useMemo(() => {
    const subject = getSubjectById(manualMobileSubjectId, visibleSubjects)
    if (!subject) return null

    return {
      source: "manual-mobile-shortcut" as const,
      subjectId: subject.id,
      subjectName: getSubjectDisplayName(subject),
      sessionDate: formatDateKey(now),
      weekNumber: getWeekNumberForDate(now),
      weekdayIndex: mobileShortcutTarget?.weekdayIndex ?? (() => {
        const jsDay = now.getDay()
        return jsDay === 0 ? 6 : jsDay - 1
      })(),
    }
  }, [manualMobileSubjectId, mobileShortcutTarget?.weekdayIndex, now, visibleSubjects])
  const activeMobileModalTarget = manualMobileShortcutTarget ?? mobileShortcutTarget
  const mobileClockLabel = useMemo(() => formatClockTime(now), [now])
  const selectedDate = useMemo(() => parseDateKey(currentDateKey), [currentDateKey])
  const selectedWeekNumber = useMemo(() => getWeekNumberForDate(selectedDate), [selectedDate])
  const weekDates = useMemo(() => getWeekDates(selectedWeekNumber), [selectedWeekNumber])
  const selectedWeekNumberRef = useRef(selectedWeekNumber)
  const currentCalendarWeekRef = useRef(currentCalendarWeek)
  const previousCalendarWeekRef = useRef(currentCalendarWeek)
  const currentDayIndex = weekDates.findIndex((date) => formatDateKey(date) === currentDateKey)
  const subjectDialogDateKey = subjectViewDateOverride ?? currentDateKey
  const subjectDialogDayIndex = weekDates.findIndex((date) => formatDateKey(date) === subjectDialogDateKey)
  const lastVisibleDayIndex = weekDates.reduce((lastIndex, date, index) => {
    return formatDateKey(date) <= todayKey ? index : lastIndex
  }, -1)
  const isWeeklyExercisesScope = practiceSectionView === "exercises" && exerciseWeeklyScopeEnabled

  // Load the persisted session for the currently selected date.
  useEffect(() => {
    return () => {
      pendingMaterialCheckupTimersRef.current.forEach((timerId) => {
        window.clearTimeout(timerId)
      })
      pendingMaterialCheckupTimersRef.current.clear()
    }
  }, [])

  useEffect(() => {
    selectedWeekNumberRef.current = selectedWeekNumber
  }, [selectedWeekNumber])

  useEffect(() => {
    currentCalendarWeekRef.current = currentCalendarWeek
  }, [currentCalendarWeek])

  useEffect(() => {
    const previousWeekNumber = previousCalendarWeekRef.current
    if (currentCalendarWeek > previousWeekNumber && selectedWeekNumber < currentCalendarWeek) {
      setCurrentDateKey(todayKey)
    }
    previousCalendarWeekRef.current = currentCalendarWeek
  }, [currentCalendarWeek, selectedWeekNumber, todayKey])

  useEffect(() => {
    const loadFromDatabase = async () => {
      readyToSync.current = false

      try {
        const response = await fetch(`/api/sessions?date=${currentDateKey}`)
        if (!response.ok) throw new Error("Failed to fetch session")
        const session = await response.json()

        if (session && Array.isArray(session.active_subject_ids)) {
          const completedSubjectsData = session.completed_subjects || {}
          const completedIds = Object.keys(completedSubjectsData)
          const nextShowAllSubjects = Boolean(session.show_all_subjects)
          const normalized = normalizeSubjectsForDay(completedIds, selectedDate, nextShowAllSubjects, visibleSubjects)
          setShowAllSubjectsForDay(nextShowAllSubjects)
          setAllCompletedSubjectIds(completedIds)
          setActiveSubjects(normalized.activeSubjects)
          setCompletedSubjects(normalized.completedSubjects)
        } else {
          setShowAllSubjectsForDay(false)
          setAllCompletedSubjectIds([])
          setActiveSubjects(getDisplaySubjectsForDate(selectedDate, false, visibleSubjects))
          setCompletedSubjects([])
        }
      } catch (error) {
        console.error("Failed to load from database:", error)
        setShowAllSubjectsForDay(false)
        setAllCompletedSubjectIds([])
        setActiveSubjects(getDisplaySubjectsForDate(selectedDate, false, visibleSubjects))
        setCompletedSubjects([])
      } finally {
        setHistory([])
        setHistoryIndex(-1)
        setIsLoading(false)
        // Only allow syncing AFTER the loaded state has been applied
        setTimeout(() => {
          readyToSync.current = true
        }, 0)
      }
    }

    loadFromDatabase()
  }, [currentDateKey, selectedDate, visibleSubjects])

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      setNow(new Date())
    }, 1000)

    return () => window.clearInterval(intervalId)
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
        const activeIds = subjectsToIds(activeSubjects)
        const completedObj = allCompletedSubjectIds.reduce(
          (acc, subject) => {
            acc[subject] = true
            return acc
          },
          {} as Record<string, boolean>
        )

        const res = await fetch("/api/sessions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            date: currentDateKey,
            activeSubjectIds: activeIds,
            completedSubjects: completedObj,
            showAllSubjects: showAllSubjectsForDay,
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
  }, [activeSubjects, allCompletedSubjectIds, currentDateKey, showAllSubjectsForDay])

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
      const target = e.target as HTMLElement | null
      const tag = target?.tagName
      const isEditable = Boolean(target?.isContentEditable)
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || isEditable) return

      if (e.ctrlKey && e.key === "Enter") {
        e.preventDefault()
        if (selectedWeekNumberRef.current < currentCalendarWeekRef.current + 1) {
          setIsNextWeekDialogOpen(true)
        }
        return
      }

      if (e.key === 'g' || e.key === 'G') {
        openAiModal()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [openAiModal])

  useEffect(() => {
    if (!mobileShortcutTarget || typeof window === "undefined") return
    if (isDialogOpen || isReviewDialogOpen || isPracticeOpen || isAiOpen || isLinkDialogOpen || isMobileShortcutPickerOpen) return

    const dismissKey = getShortcutDismissKey(mobileShortcutTarget.sessionDate, mobileShortcutTarget.shortcutIndex ?? -1)
    if (window.localStorage.getItem(dismissKey) === "1") return

    setIsMobileShortcutOpen(true)
  }, [isAiOpen, isDialogOpen, isLinkDialogOpen, isMobileShortcutPickerOpen, isPracticeOpen, isReviewDialogOpen, mobileShortcutTarget])

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

  const loadSubjectDayData = useCallback(async () => {
    if (!isDialogOpen || !currentSubject) return

    setIsEntriesLoading(true)
    setIsMaterialsLoading(true)
    setEntriesError("")

    try {
      const entriesParams = new URLSearchParams({
        subjectId: currentSubject.id,
        weekNumber: String(selectedWeekNumber),
      })
      const materialsParams = new URLSearchParams({
        subjectId: currentSubject.id,
        weekNumber: String(selectedWeekNumber),
      })

      if (practiceSectionView === "exercises" && subjectViewDateOverride) {
        materialsParams.set("sessionDate", subjectDialogDateKey)
      } else if (isWeeklyExercisesScope) {
        materialsParams.set("scope", "week")
      } else {
        entriesParams.set("sessionDate", currentDateKey)
        materialsParams.set("sessionDate", currentDateKey)
      }

      const materialRequests =
        practiceSectionView === "exercises" && !subjectViewDateOverride && isWeeklyExercisesScope
          ? [
              fetch(`/api/subject-day-materials?${materialsParams.toString()}`),
              fetch(
                `/api/subject-day-materials?${new URLSearchParams({
                  subjectId: currentSubject.id,
                  weekNumber: String(selectedWeekNumber),
                  sessionDate: subjectDialogDateKey,
                }).toString()}`
              ),
            ]
          : [fetch(`/api/subject-day-materials?${materialsParams.toString()}`)]

      const [entriesResponse, ...materialsResponses] = await Promise.all([
        fetch(`/api/subject-day-entries?${entriesParams.toString()}`),
        ...materialRequests,
      ])
      const [entriesPayload, ...materialsPayloads] = await Promise.all([
        parseJsonResponse(entriesResponse),
        ...materialsResponses.map((response) => parseJsonResponse(response)),
      ])

      if (!entriesResponse.ok) {
        throw new Error(getErrorMessage(entriesPayload, "No se pudieron cargar las dudas del dia."))
      }

      const failedMaterialsResponse = materialsResponses.findIndex((response) => !response.ok)
      if (failedMaterialsResponse >= 0) {
        throw new Error(getErrorMessage(materialsPayloads[failedMaterialsResponse], "No se pudieron cargar los materiales del dia."))
      }

      setEntries(sortSubjectDayEntries(Array.isArray(entriesPayload) ? entriesPayload : []))
      const normalizedMaterialGroups = materialsPayloads.map((payload) =>
        Array.isArray(payload) ? (payload as SubjectDayMaterial[]) : []
      )
      setMaterials(mergeSubjectDayMaterials(...normalizedMaterialGroups))
    } catch (error) {
      console.error("Failed to load subject day data:", error)
      setEntries([])
      setMaterials([])
      setEntriesError(error instanceof Error ? error.message : "No se pudieron cargar las dudas del dia.")
    } finally {
      setIsEntriesLoading(false)
      setIsMaterialsLoading(false)
    }
  }, [currentDateKey, currentSubject, isDialogOpen, isWeeklyExercisesScope, practiceSectionView, selectedWeekNumber, subjectDialogDateKey])

  useEffect(() => {
    void loadSubjectDayData()
  }, [loadSubjectDayData])

  useEffect(() => {
    if (typeof window === "undefined") return

    const channel = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel("practice-materials") : null
    const handleRefreshPayload = (payload: unknown) => {
      if (!payload || typeof payload !== "object" || !currentSubject || !isDialogOpen) return
      if (!("subjectId" in payload) || !("sessionDate" in payload) || !("weekNumber" in payload)) return

      const subjectId = typeof payload.subjectId === "string" ? payload.subjectId : ""
      const sessionDate = typeof payload.sessionDate === "string" ? payload.sessionDate : ""
      const weekNumber = Number(payload.weekNumber)
      if (subjectId !== currentSubject.id || sessionDate !== subjectDialogDateKey || weekNumber !== selectedWeekNumber) return

      void loadSubjectDayData()
    }

    const handleStorage = (event: StorageEvent) => {
      if (event.key !== "practice-materials:refresh" || !event.newValue) return
      try {
        handleRefreshPayload(JSON.parse(event.newValue))
      } catch {}
    }

    const handleMessage = (event: MessageEvent) => {
      handleRefreshPayload(event.data)
    }

    channel?.addEventListener("message", handleMessage)
    window.addEventListener("storage", handleStorage)

    return () => {
      channel?.removeEventListener("message", handleMessage)
      channel?.close()
      window.removeEventListener("storage", handleStorage)
    }
  }, [currentSubject, isDialogOpen, loadSubjectDayData, selectedWeekNumber, subjectDialogDateKey])

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

      clearPendingFeaturedSave()
      audioCacheRef.current.forEach((url) => URL.revokeObjectURL(url))
    }
  }, [reviewAudio])

  const disposeReviewAudio = (nextAudio?: ReviewAudio | null) => {
    if (reviewAudio && reviewAudio !== nextAudio) {
      URL.revokeObjectURL(reviewAudio.url)
    }
  }

  const clearPendingFeaturedSave = () => {
    if (pendingFeaturedSaveTimerRef.current) {
      window.clearTimeout(pendingFeaturedSaveTimerRef.current)
      pendingFeaturedSaveTimerRef.current = null
    }
  }

  const flushPendingFeaturedUpdate = async () => {
    const pendingUpdate = pendingFeaturedUpdateRef.current
    if (!pendingUpdate) return

    clearPendingFeaturedSave()
    pendingFeaturedUpdateRef.current = null

    try {
      const response = await fetch(`/api/subject-day-entries/${pendingUpdate.entryId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isFeatured: pendingUpdate.isFeatured }),
      })

      const payload = await response.json()
      if (!response.ok) {
        throw new Error(getErrorMessage(payload, "No se pudo actualizar el destacado."))
      }

      const updatedEntry = payload as SubjectDayEntry
      setEntries((previousEntries) =>
        sortSubjectDayEntries(
          previousEntries.map((item) => {
            if (item.session_date === updatedEntry.session_date && item.subject_id === updatedEntry.subject_id && updatedEntry.is_featured) {
              return { ...item, is_featured: false }
            }
            return item.id === updatedEntry.id ? updatedEntry : item
          })
        )
      )
    } catch (error) {
      console.error("Failed to persist featured entry:", error)
      setEntriesError(error instanceof Error ? error.message : "No se pudo actualizar el destacado.")
    }
  }

  const scheduleFeaturedSave = () => {
    clearPendingFeaturedSave()
    pendingFeaturedSaveTimerRef.current = window.setTimeout(() => {
      void flushPendingFeaturedUpdate()
    }, 3000)
  }

  const stopAndDiscardRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.onstop = null
      mediaRecorderRef.current.stop()
    }
    mediaRecorderRef.current = null

    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((track) => track.stop())
      mediaStreamRef.current = null
    }

    recordingChunksRef.current = []
    setIsRecording(false)
    setRecordingTarget(null)
  }

  const resetSubjectUiState = () => {
    clearPendingFeaturedSave()
    pendingFeaturedUpdateRef.current = null
    audioCacheRef.current.forEach((url) => URL.revokeObjectURL(url))
    audioCacheRef.current.clear()
    audioElementRefs.current = {}
    setEntries([])
    setMaterials([])
    setPendingMaterials([])
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
    setPracticeSectionView("theory")
    setExerciseWeeklyScopeEnabled(false)
    setSubjectViewDateOverride(null)
    setSelectedPracticeMaterialId(null)
    setIsUploadingMaterialType(null)
    setIsLinkDialogOpen(false)
    setLinkEntryId(null)
    setLinkDraft({ label: "", url: "" })
    setIsSavingLink(false)
    setIsContinueOpen(false)
    setIsContinueLoading(false)
    setContinueError("")
    setContinuePayload(null)
  }

  const cancelReview = () => {
    disposeReviewAudio(null)
    setReviewAudio(null)
    setIsReviewDialogOpen(false)
    setRecordingTarget(null)
  }

  const closeMobileShortcutModal = (persistDismissal: boolean) => {
    if (recordingTarget?.source === "mobile-shortcut" || recordingTarget?.source === "manual-mobile-shortcut") {
      stopAndDiscardRecording()
      cancelReview()
    }

    if (
      persistDismissal &&
      typeof window !== "undefined" &&
      mobileShortcutTarget?.shortcutIndex !== undefined
    ) {
      window.localStorage.setItem(
        getShortcutDismissKey(mobileShortcutTarget.sessionDate, mobileShortcutTarget.shortcutIndex),
        "1"
      )
    }

    setIsMobileShortcutOpen(false)
    setManualMobileSubjectId("")
  }

  const openManualMobileShortcutPicker = () => {
    setManualMobileSubjectId("")
    setIsMobileShortcutPickerOpen(true)
  }

  const handleManualMobileSubjectSelect = (subjectId: string) => {
    setManualMobileSubjectId(subjectId)
    setRecordingError("")
    setEntriesError("")
    setIsMobileShortcutPickerOpen(false)
    setIsMobileShortcutOpen(true)
  }

  const closeSubjectDialog = async () => {
    await flushPendingFeaturedUpdate()
    stopAndDiscardRecording()

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
    resetSubjectUiState()
    setIsDialogOpen(true)
  }

  const openSubjectDay = async (subjectId: string, dateKey: string) => {
    await flushPendingFeaturedUpdate()
    const subject = getSubjectById(subjectId, visibleSubjects)
    if (!subject) return

    setCurrentSubject(subject)
    setCurrentDateKey(dateKey)
    resetSubjectUiState()
    setIsReviewOpen(false)
    setIsDialogOpen(true)
  }

  const markSubjectAsCompleted = (subject: Subject) => {
    if (!completedSubjects.some((item) => item.id === subject.id)) {
      const nextActive = activeSubjects.filter((item) => item.id !== subject.id)
      const nextCompleted = [...completedSubjects, subject]
      const nextCompletedIds = Array.from(new Set([...allCompletedSubjectIds, subject.id]))
      const nextHistory = history.slice(0, historyIndex + 1)
      nextHistory.push({ activeSubjects: nextActive, completedSubjects: nextCompleted, allCompletedIds: nextCompletedIds })

      setActiveSubjects(nextActive)
      setCompletedSubjects(nextCompleted)
      setAllCompletedSubjectIds(nextCompletedIds)
      setHistory(nextHistory)
      setHistoryIndex(nextHistory.length - 1)
    }

    closeSubjectDialog()
  }

  const moveDay = async (direction: -1 | 1) => {
    await flushPendingFeaturedUpdate()
    const nextIndex = subjectDialogDayIndex + direction
    if (nextIndex < 0 || nextIndex >= weekDates.length || nextIndex > lastVisibleDayIndex) return
    const nextDateKey = formatDateKey(weekDates[nextIndex])
    if (subjectViewDateOverride) {
      setSubjectViewDateOverride(nextDateKey)
    } else {
      setCurrentDateKey(nextDateKey)
    }
    setSelectedPracticeMaterialId(null)
  }

  const moveWeek = async (direction: -1 | 1) => {
    await flushPendingFeaturedUpdate()
    const nextDate = parseDateKey(currentDateKey)
    nextDate.setDate(nextDate.getDate() + direction * 7)

    const nextWeekNumber = getWeekNumberForDate(nextDate)
    const latestWeekNumber = getCurrentWeekNumber()
    if (nextWeekNumber < 0 || nextWeekNumber > latestWeekNumber) return

    setCurrentDateKey(formatDateKey(nextDate))
  }

  const openWeekAudioDay = async (dateKey: string) => {
    await flushPendingFeaturedUpdate()
    setSubjectViewDateOverride(dateKey)
    setSelectedPracticeMaterialId(null)
  }

  const returnToCurrentDayView = async () => {
    await flushPendingFeaturedUpdate()
    setSubjectViewDateOverride(null)
    setSelectedPracticeMaterialId(null)
  }

  const closeSubjectDialogOrReturn = async () => {
    if (practiceSectionView === "exercises" && subjectViewDateOverride) {
      await returnToCurrentDayView()
      return
    }

    await closeSubjectDialog()
  }

  const startNextWeek = async () => {
    await flushPendingFeaturedUpdate()

    const targetWeekNumber = getCurrentWeekNumber(new Date()) + 1
    const nextWeekStart = getWeekDates(targetWeekNumber)[0]
    setCurrentDateKey(formatDateKey(nextWeekStart))
    setIsNextWeekDialogOpen(false)
  }

  const startRecording = async (target: AudioUploadTarget) => {
    setRecordingError("")
    cancelReview()

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
      setRecordingTarget(target)

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
        setIsReviewDialogOpen(
          target.source === "subject-dialog" || target.source === "continue-practice" || target.source === "continue-context"
        )
      }

      recorder.start()
      setIsRecording(true)
    } catch (error) {
      if (mediaStreamRef.current) {
        mediaStreamRef.current.getTracks().forEach((track) => track.stop())
        mediaStreamRef.current = null
      }
      mediaRecorderRef.current = null
      console.error("Failed to start recording:", error)
      setRecordingError(error instanceof Error ? error.message : "No se pudo iniciar la grabacion.")
      setIsRecording(false)
      setRecordingTarget(null)
    }
  }

  const stopRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      try {
        mediaRecorderRef.current.requestData?.()
      } catch {}
      mediaRecorderRef.current.stop()
    }
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((track) => track.stop())
      mediaStreamRef.current = null
    }
  }

  const confirmReview = async () => {
    if (!recordingTarget || !reviewAudio) return
    const target = recordingTarget

    setIsUploadingAudio(true)
    setEntriesError("")

    try {
      const audioFile = new File([reviewAudio.blob], `${target.subjectId}-${target.sessionDate}.webm`, {
        type: reviewAudio.mimeType,
      })

      const sessionResponse = await fetch("/api/subject-day-entries/upload-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subjectId: target.subjectId,
          subjectName: target.subjectName,
          sessionDate: target.sessionDate,
          weekNumber: target.weekNumber,
          materialId: target.materialId ?? null,
          mimeType: audioFile.type || "audio/webm",
        }),
      })
      const sessionPayload = (await requireOkJson(
        sessionResponse,
        "No se pudo preparar la subida del audio."
      )) as DriveUploadSessionResponse

      const { driveFileId } = await uploadBlobToStorage(sessionPayload, audioFile)

      const response = await fetch("/api/subject-day-entries/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subjectId: target.subjectId,
          sessionDate: target.sessionDate,
          weekNumber: target.weekNumber,
          materialId: target.materialId ?? null,
          driveFileId,
          fileName: audioFile.name,
        }),
      })
      const payload = await requireOkJson(response, "No se pudo confirmar el audio.")

      let createdEntry = payload as SubjectDayEntry
      if (target.source === "continue-context") {
        const featuredResponse = await fetch(`/api/subject-day-entries/${createdEntry.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ isFeatured: true }),
        })
        const featuredPayload = await requireOkJson(featuredResponse, "No se pudo guardar el audio de contexto.")
        createdEntry = featuredPayload as SubjectDayEntry
      }

      if (currentSubject?.id === target.subjectId && currentDateKey === target.sessionDate) {
        setEntries((previousEntries) =>
          sortSubjectDayEntries(
            [...previousEntries.filter((entry) => !(target.source === "continue-context" && entry.is_featured)), createdEntry]
          )
        )
        if (target.source === "continue-context") {
          setContinuePayload((previous) =>
            previous
              ? {
                  ...previous,
                  previousFeaturedEntry: createdEntry,
                }
              : previous
          )
        }
      }

      cancelReview()
      if (target.source === "mobile-shortcut") {
        closeMobileShortcutModal(true)
      }
    } catch (error) {
      console.error("Failed to upload audio entry:", error)
      setEntriesError(error instanceof Error ? error.message : "No se pudo confirmar el audio.")
    } finally {
      setIsUploadingAudio(false)
    }
  }

  const handleMobileShortcutReset = () => {
    if ((recordingTarget?.source === "mobile-shortcut" || recordingTarget?.source === "manual-mobile-shortcut") && isRecording) {
      stopAndDiscardRecording()
    }

    setRecordingError("")
    cancelReview()
  }

  const startAnswerEdit = (entry: SubjectDayEntry) => {
    setManualEntryTarget(null)
    setManualQuestionDraft("")
    setManualAnswerDraft("")
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

  const closeAnswerDialog = () => {
    setEditingAnswerId(null)
    setManualEntryTarget(null)
    setManualQuestionDraft("")
    setManualAnswerDraft("")
  }

  const startManualEntry = (target: ManualEntryTarget) => {
    setEditingAnswerId(null)
    setManualEntryTarget(target)
    setManualQuestionDraft("")
    setManualAnswerDraft("")
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

      setEntries((previousEntries) => sortSubjectDayEntries(previousEntries.map((item) => (item.id === entry.id ? (payload as SubjectDayEntry) : item))))
      closeAnswerDialog()
      setRevealedAnswers((previous) => ({ ...previous, [entry.id]: false }))
    } catch (error) {
      console.error("Failed to save answer:", error)
      setEntriesError(error instanceof Error ? error.message : "No se pudo guardar la respuesta.")
    } finally {
      setIsSavingAnswerId(null)
    }
  }

  const saveManualEntry = async () => {
    if (!manualEntryTarget) return

    const transcriptText = manualQuestionDraft.trim()
    const answerText = manualAnswerDraft.trim()
    if (!transcriptText) {
      setEntriesError("Escribe la duda antes de guardar.")
      return
    }

    setIsSavingAnswerId(-1)
    setEntriesError("")

    try {
      const response = await fetch("/api/subject-day-entries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subjectId: manualEntryTarget.subjectId,
          sessionDate: manualEntryTarget.sessionDate,
          weekNumber: manualEntryTarget.weekNumber,
          weekdayIndex: manualEntryTarget.weekdayIndex,
          materialId: manualEntryTarget.materialId ?? null,
          transcriptText,
          answerText,
        }),
      })

      const payload = await response.json()
      if (!response.ok) {
        throw new Error(getErrorMessage(payload, "No se pudo crear la duda."))
      }

      setEntries((previousEntries) => sortSubjectDayEntries([...previousEntries, payload as SubjectDayEntry]))
      closeAnswerDialog()
    } catch (error) {
      console.error("Failed to create manual entry:", error)
      setEntriesError(error instanceof Error ? error.message : "No se pudo crear la duda.")
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

      setEntries((previousEntries) => sortSubjectDayEntries(previousEntries.map((item) => (item.id === entry.id ? (payload as SubjectDayEntry) : item))))
      setEditingTitleId(null)
    } catch (error) {
      console.error("Failed to save entry title:", error)
      setEntriesError(error instanceof Error ? error.message : "No se pudo guardar el nombre de la duda.")
    } finally {
      setIsSavingTitleId(null)
    }
  }

  const copyEntries = async (entriesToCopy: SubjectDayEntry[], successMessage: string, onError?: (message: string) => void) => {
    if (entriesToCopy.length === 0 || isCopyingEntries) return

    setIsCopyingEntries(true)
    try {
      const payload = entriesToCopy
        .map((entry) => {
          const title = getEntryDisplayTitle(entry)
          const transcript = entry.transcript_text?.trim() || ""
          const answer = entry.answer_text?.trim() || ""
          return `${title}\nTranscripcion: ${transcript}\nRespuesta: ${answer}`
        })
        .join("\n\n")
      await navigator.clipboard.writeText(payload)
      toast({ title: "Copiado", description: successMessage })
    } catch (error) {
      console.error("Failed to copy entries:", error)
      if (onError) {
        onError("No se pudieron copiar las dudas.")
      } else {
        setEntriesError("No se pudieron copiar las dudas.")
      }
      toast({ title: "Error", description: "No se pudieron copiar las dudas.", variant: "destructive" })
    } finally {
      window.setTimeout(() => setIsCopyingEntries(false), 600)
    }
  }

  const copyEntriesForDay = async () => {
    await copyEntries(activeDayEntries, "Contenido copiado al portapapeles")
  }

  const copyContinueEntries = async () => {
    setContinueError("")
    await copyEntries(continueMaterialEntries, "Contenido copiado al portapapeles", setContinueError)
  }

  const copyEntriesForMaterial = async (materialId: number) => {
    await copyEntries(practiceEntriesByMaterialId[materialId] ?? [], "Contenido del PDF copiado al portapapeles")
  }

  const copyEntriesForSession = async (sessionDate: string) => {
    await copyEntries(entries.filter((entry) => entry.session_date === sessionDate), "Contenido del dia copiado al portapapeles")
  }

  const toggleFeaturedEntry = (entry: SubjectDayEntry) => {
    const nextIsFeatured = !entry.is_featured
    pendingFeaturedUpdateRef.current = {
      entryId: entry.id,
      isFeatured: nextIsFeatured,
    }

    setEntriesError("")
    setEntries((previousEntries) =>
      sortSubjectDayEntries(
        previousEntries.map((item) => {
          if (item.session_date === entry.session_date && item.subject_id === entry.subject_id && nextIsFeatured) {
            return { ...item, is_featured: item.id === entry.id }
          }
          return item.id === entry.id ? { ...item, is_featured: nextIsFeatured } : item
        })
      )
    )
    scheduleFeaturedSave()
  }

  const deleteEntry = async (entry: SubjectDayEntry) => {
    if (isDeletingEntryId === entry.id) return

    setIsDeletingEntryId(entry.id)
    setEntriesError("")

    try {
      const response = await fetch(`/api/subject-day-entries/${entry.id}`, {
        method: "DELETE",
      })

      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(getErrorMessage(payload, "No se pudo borrar la duda."))
      }

      setEntries((previousEntries) =>
        sortSubjectDayEntries(previousEntries.filter((item) => item.id !== entry.id))
      )
      setPracticeEntries((previousEntries) => previousEntries.filter((item) => item.id !== entry.id))
      setPracticeVisibleEntries((previousEntries) => previousEntries.filter((item) => item.id !== entry.id))

      setRevealedAnswers((previous) => {
        const next = { ...previous }
        delete next[entry.id]
        return next
      })
      setAnswerDrafts((previous) => {
        const next = { ...previous }
        delete next[entry.id]
        return next
      })
      setQuestionDrafts((previous) => {
        const next = { ...previous }
        delete next[entry.id]
        return next
      })
      setTitleDrafts((previous) => {
        const next = { ...previous }
        delete next[entry.id]
        return next
      })

      if (editingAnswerId === entry.id) setEditingAnswerId(null)
      if (editingTitleId === entry.id) setEditingTitleId(null)
      if (expandedAudioEntryId === entry.id) {
        audioElementRefs.current[entry.id]?.pause()
        setExpandedAudioEntryId(null)
      }

      setContinuePayload((previous) =>
        previous?.previousFeaturedEntry?.id === entry.id
          ? { ...previous, previousFeaturedEntry: null }
          : previous
      )
    } catch (error) {
      console.error("Failed to delete entry:", error)
      setEntriesError(error instanceof Error ? error.message : "No se pudo borrar la duda.")
    } finally {
      setIsDeletingEntryId(null)
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

  const handleMaterialUpload = async (materialType: SubjectDayMaterialType, file: File | null) => {
    if (!currentSubject || !file) return

    if (file.type !== "application/pdf") {
      setEntriesError("Solo se permiten archivos PDF.")
      return
    }

    setEntriesError("")
    setIsUploadingMaterialType(materialType)
    const tempId = -Date.now()
    const pendingMaterial: PendingSubjectDayMaterial = {
      id: tempId,
      subject_id: currentSubject.id,
      week_number: selectedWeekNumber,
      session_date: subjectDialogDateKey,
      weekday_index: subjectDialogDayIndex >= 0 ? subjectDialogDayIndex : 0,
      material_type: materialType,
      order_index:
        (materialType === "theory" ? theoryMaterials.length : practiceMaterials.length) +
        pendingMaterials.filter((material) => material.material_type === materialType).length +
        1,
      file_name: file.name,
      drive_file_id: "",
      drive_mime_type: "application/pdf",
      drive_web_view_link: "",
      is_checkup_done: false,
      created_at: "",
      updated_at: "",
      is_pending_upload: true,
    }
    setPendingMaterials((previousMaterials) => [...previousMaterials, pendingMaterial])

    try {
      const sessionResponse = await fetch("/api/subject-day-materials/upload-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subjectId: currentSubject.id,
          subjectName: getSubjectDisplayName(currentSubject),
          sessionDate: subjectDialogDateKey,
          weekNumber: selectedWeekNumber,
          materialType,
          fileName: file.name,
          mimeType: file.type || "application/pdf",
        }),
      })
      const sessionPayload = (await requireOkJson(
        sessionResponse,
        "No se pudo preparar la subida del PDF."
      )) as DriveUploadSessionResponse

      const { driveFileId } = await uploadBlobToStorage(sessionPayload, file)
      const persistedFileName = file.name.trim()

      const response = await fetch("/api/subject-day-materials/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subjectId: currentSubject.id,
          sessionDate: subjectDialogDateKey,
          weekNumber: selectedWeekNumber,
          materialType,
          driveFileId,
          fileName: persistedFileName,
        }),
      })
      const payload = await requireOkJson(response, "No se pudo confirmar el PDF.")

      setMaterials((previousMaterials) => sortSubjectDayMaterials([...previousMaterials, payload as SubjectDayMaterial]))
    } catch (error) {
      console.error("Failed to upload subject day material:", error)
      setEntriesError(error instanceof Error ? error.message : "No se pudo subir el PDF.")
    } finally {
      setPendingMaterials((previousMaterials) => previousMaterials.filter((material) => material.id !== tempId))
      setIsUploadingMaterialType(null)
      if (theoryFileInputRef.current) theoryFileInputRef.current.value = ""
      if (practiceFileInputRef.current) practiceFileInputRef.current.value = ""
    }
  }

  const loadContinuePayload = async ({ silent = false }: { silent?: boolean } = {}) => {
    if (!currentSubject) return
    const localPayload = buildLocalContinuePayload()

    if (!silent && !localPayload) {
      setIsContinueLoading(true)
    }
    setContinueError("")

    try {
      const params = new URLSearchParams({
        subjectId: currentSubject.id,
        sessionDate: subjectDialogDateKey,
        weekNumber: String(selectedWeekNumber),
      })

      const response = await fetch(`/api/subject-day-materials/next-practice?${params.toString()}`)
      const payload = await response.json()
      if (!response.ok) {
        throw new Error(getErrorMessage(payload, "No se pudo cargar el siguiente PDF de practica."))
      }

      const serverPayload = payload as ContinuePayload

      setContinuePayload((previous) => ({
        ...serverPayload,
        material: localPayload?.material ?? previous?.material ?? serverPayload.material,
        previousFeaturedEntry:
          localContinueFeaturedEntry ??
          previous?.previousFeaturedEntry ??
          localPayload?.previousFeaturedEntry ??
          serverPayload.previousFeaturedEntry,
      }))
    } catch (error) {
      console.error("Failed to load next practice material:", error)
      setContinuePayload((previous) => previous ?? localPayload)
      setContinueError(error instanceof Error ? error.message : "No se pudo cargar el siguiente PDF de practica.")
    } finally {
      if (!silent && !localPayload) {
        setIsContinueLoading(false)
      }
    }
  }

  const openContinueModal = async (materialId?: number) => {
    const selectedMaterial =
      typeof materialId === "number"
        ? practiceMaterials.find((material) => !("is_pending_upload" in material) && material.id === materialId) ?? null
        : null

    setSelectedPracticeMaterialId(selectedMaterial?.id ?? null)

    const localPayload: ContinuePayload | null = currentSubject
      ? {
          material: selectedMaterial ?? buildLocalContinuePayload()?.material ?? null,
          previousFeaturedEntry: localContinueFeaturedEntry ?? continuePayload?.previousFeaturedEntry ?? null,
        }
      : null

    setContinuePayload(localPayload)
    setIsContinueOpen(true)

    if (!selectedMaterial) {
      void loadContinuePayload({ silent: Boolean(localPayload) })
    }
  }

  const toggleMaterialCheckup = async (materialToUpdate: SubjectDayMaterial, checked: boolean) => {
    const isCurrentContinueMaterial = currentContinueMaterial?.id === materialToUpdate.id
    const previousPayload = continuePayload
    const optimisticMaterial = { ...materialToUpdate, is_checkup_done: checked }
    const nextMaterials = sortSubjectDayMaterials(
      materials.map((material) => (material.id === optimisticMaterial.id ? optimisticMaterial : material))
    )
    const existingTimer = pendingMaterialCheckupTimersRef.current.get(materialToUpdate.id)
    const nextContinueMaterial =
      currentSubject && isCurrentContinueMaterial
        ? getNextUncheckedPracticeMaterial(nextMaterials, {
            subjectId: currentSubject.id,
            sessionDate: subjectDialogDateKey,
            weekNumber: selectedWeekNumber,
          })
        : null

    if (existingTimer) {
      window.clearTimeout(existingTimer)
      pendingMaterialCheckupTimersRef.current.delete(materialToUpdate.id)
    }

    setContinueError("")
    if (isCurrentContinueMaterial) {
      setContinuePayload((previous) =>
        previous
          ? {
              ...previous,
              material: checked ? nextContinueMaterial : optimisticMaterial,
            }
          : previous
      )
    }
    setMaterials(nextMaterials)

    const timerId = window.setTimeout(async () => {
      pendingMaterialCheckupTimersRef.current.delete(materialToUpdate.id)

      try {
        const response = await fetch(`/api/subject-day-materials/${materialToUpdate.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ isCheckupDone: checked }),
        })
        const payload = await response.json()
        if (!response.ok) {
          throw new Error(getErrorMessage(payload, "No se pudo actualizar el CheckUp."))
        }

        const updatedMaterial = payload as SubjectDayMaterial
        setMaterials((previousMaterials) =>
          sortSubjectDayMaterials(
            previousMaterials.map((material) => (material.id === updatedMaterial.id ? updatedMaterial : material))
          )
        )

        if (!checked && isCurrentContinueMaterial) {
          setContinuePayload((previous) => (previous ? { ...previous, material: updatedMaterial } : previous))
        }
      } catch (error) {
        console.error("Failed to update practice material checkup:", error)
        if (isCurrentContinueMaterial) {
          setContinuePayload(previousPayload)
        }
        setMaterials((previousMaterials) =>
          sortSubjectDayMaterials(
            previousMaterials.map((material) =>
              material.id === optimisticMaterial.id ? materialToUpdate : material
            )
          )
        )
        setContinueError(error instanceof Error ? error.message : "No se pudo actualizar el CheckUp.")
      }
    }, 3000)

    pendingMaterialCheckupTimersRef.current.set(materialToUpdate.id, timerId)
  }

  const deleteMaterial = async (materialToDelete: SubjectDayMaterial) => {
    if (isDeletingMaterialId === materialToDelete.id) return

    const existingTimer = pendingMaterialCheckupTimersRef.current.get(materialToDelete.id)
    if (existingTimer) {
      window.clearTimeout(existingTimer)
      pendingMaterialCheckupTimersRef.current.delete(materialToDelete.id)
    }

    setIsDeletingMaterialId(materialToDelete.id)
    setEntriesError("")
    setContinueError("")

    try {
      const response = await fetch(`/api/subject-day-materials/${materialToDelete.id}`, {
        method: "DELETE",
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(getErrorMessage(payload, "No se pudo borrar el archivo."))
      }

      setMaterials((previousMaterials) =>
        sortSubjectDayMaterials(previousMaterials.filter((material) => material.id !== materialToDelete.id))
      )
      setPendingMaterials((previousMaterials) => previousMaterials.filter((material) => material.id !== materialToDelete.id))
      setEntries((previousEntries) =>
        sortSubjectDayEntries(previousEntries.filter((entry) => entry.subject_day_material_id !== materialToDelete.id))
      )

      if (currentContinueMaterial?.id === materialToDelete.id && currentSubject) {
        const remainingMaterials = materials.filter((material) => material.id !== materialToDelete.id)
        setContinuePayload((previous) =>
          previous
            ? {
                ...previous,
                material: getNextUncheckedPracticeMaterial(remainingMaterials, {
                  subjectId: currentSubject.id,
                  sessionDate: subjectDialogDateKey,
                  weekNumber: selectedWeekNumber,
                }),
              }
            : previous
        )
      }
    } catch (error) {
      console.error("Failed to delete material:", error)
      const message = error instanceof Error ? error.message : "No se pudo borrar el archivo."
      setEntriesError(message)
      setContinueError(message)
    } finally {
      setIsDeletingMaterialId(null)
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
    setPracticeLaunchView("exercises")
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

  const openExercisesPracticeSubject = async (subjectId: string) => {
    await flushPendingFeaturedUpdate()
    const subject = getSubjectById(subjectId, visibleSubjects)
    if (!subject) return

    setIsPracticeOpen(false)
    setCurrentSubject(subject)
    resetSubjectUiState()
    setExerciseWeeklyScopeEnabled(true)
    setPracticeSectionView("exercises")
    setIsDialogOpen(true)
  }

  const openReviewModal = () => {
    setReviewSubjectId("")
    setReviewEntries([])
    setReviewError("")
    setIsReviewOpen(true)
  }

  const loadReviewEntries = async (subjectId: string) => {
    setIsLoadingReview(true)
    setReviewError("")
    setReviewSubjectId(subjectId)

    try {
      const params = new URLSearchParams({ subjectId })
      const response = await fetch(`/api/subject-day-entries?${params.toString()}`)
      const payload = await parseJsonResponse(response)
      if (!response.ok) {
        throw new Error(getErrorMessage(payload, "No se pudieron cargar los destacados."))
      }

      const normalizedEntries = Array.isArray(payload) ? (payload as SubjectDayEntry[]) : []
      setReviewEntries(
        normalizedEntries.filter((entry) => entry.is_featured).sort((left, right) => {
          if (left.week_number !== right.week_number) return left.week_number - right.week_number
          return left.session_date.localeCompare(right.session_date)
        })
      )
    } catch (error) {
      console.error("Failed to load review entries:", error)
      setReviewEntries([])
      setReviewError(error instanceof Error ? error.message : "No se pudieron cargar los destacados.")
    } finally {
      setIsLoadingReview(false)
    }
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

    const nextPracticeState: "erre" | null = estado === "erre" ? "erre" : null
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
      setActiveSubjects(state.activeSubjects)
      setCompletedSubjects(state.completedSubjects)
      setAllCompletedSubjectIds(state.allCompletedIds)
      setHistoryIndex(newIndex)
    }
  }

  const handleRedo = () => {
    if (historyIndex < history.length - 1) {
      const newIndex = historyIndex + 1
      const state = history[newIndex]
      setActiveSubjects(state.activeSubjects)
      setCompletedSubjects(state.completedSubjects)
      setAllCompletedSubjectIds(state.allCompletedIds)
      setHistoryIndex(newIndex)
    }
  }

  const canUndo = historyIndex > 0
  const canRedo = historyIndex < history.length - 1
  const currentPracticeEntry = practiceVisibleEntries[currentPracticeIndex]
  const practiceDaySubjects = useMemo(
    () => getDisplaySubjectsForDate(selectedDate, showAllSubjectsForDay, visibleSubjects),
    [selectedDate, showAllSubjectsForDay, visibleSubjects]
  )
  const latestWeekNumber = currentCalendarWeek
  const theoryMaterials = useMemo(
    () =>
      sortSubjectDayMaterials(
        [...materials, ...pendingMaterials].filter((material) => material.material_type === "theory")
      ),
    [materials, pendingMaterials]
  )
  const practiceMaterials = useMemo(
    () =>
      sortSubjectDayMaterials(
        [...materials, ...pendingMaterials].filter((material) => material.material_type === "practice")
      ),
    [materials, pendingMaterials]
  )
  const activeDayEntries = useMemo(
    () => entries.filter((entry) => entry.session_date === subjectDialogDateKey),
    [entries, subjectDialogDateKey]
  )
  const theoryDayEntries = useMemo(
    () => activeDayEntries.filter((entry) => entry.subject_day_material_id == null),
    [activeDayEntries]
  )
  const practiceEntriesByMaterialId = useMemo(() => {
    return entries.reduce<Record<number, SubjectDayEntry[]>>((accumulator, entry) => {
      if (entry.subject_day_material_id == null) return accumulator
      const materialId = entry.subject_day_material_id
      const current = accumulator[materialId] ?? []
      current.push(entry)
      accumulator[materialId] = current
      return accumulator
    }, {})
  }, [entries])
  const selectedPracticeMaterialEntries = useMemo(
    () => (selectedPracticeMaterialId ? entries.filter((entry) => entry.subject_day_material_id === selectedPracticeMaterialId) : []),
    [entries, selectedPracticeMaterialId]
  )
  const selectedPracticeMaterial = useMemo(
    () => practiceMaterials.find((material) => !("is_pending_upload" in material) && material.id === selectedPracticeMaterialId) ?? null,
    [practiceMaterials, selectedPracticeMaterialId]
  )
  const currentContinueMaterial = selectedPracticeMaterial ?? continuePayload?.material ?? null
  const continueMaterialEntries = useMemo(
    () =>
      currentContinueMaterial
        ? entries.filter((entry) => entry.subject_day_material_id === currentContinueMaterial.id)
        : [],
    [currentContinueMaterial, entries]
  )
  useEffect(() => {
    if (selectedPracticeMaterialId == null) return
    if (selectedPracticeMaterial || selectedPracticeMaterialEntries.length > 0) return
    setSelectedPracticeMaterialId(null)
  }, [selectedPracticeMaterial, selectedPracticeMaterialEntries.length, selectedPracticeMaterialId])
  const localContinueFeaturedEntry = useMemo(
    () =>
      entries.find(
        (entry) =>
          entry.subject_id === currentSubject?.id &&
          entry.session_date === subjectDialogDateKey &&
          entry.is_featured &&
          entry.subject_day_material_id == null
      ) ?? null,
    [currentSubject?.id, entries, subjectDialogDateKey]
  )
  const weekAudioDays = useMemo(() => {
    const grouped = entries.reduce<Record<string, SubjectDayEntry[]>>((accumulator, entry) => {
      const current = accumulator[entry.session_date] ?? []
      current.push(entry)
      accumulator[entry.session_date] = current
      return accumulator
    }, {})

    return Object.entries(grouped)
      .map(([sessionDate, dayEntries]) => ({
        sessionDate,
        entries: sortSubjectDayEntries(dayEntries),
      }))
      .sort((left, right) => left.sessionDate.localeCompare(right.sessionDate))
  }, [entries])
  const buildLocalContinuePayload = useCallback((): ContinuePayload | null => {
    if (!currentSubject) return null

    return {
      material:
        selectedPracticeMaterial ??
        getNextUncheckedPracticeMaterial(materials, {
          subjectId: currentSubject.id,
          sessionDate: subjectDialogDateKey,
          weekNumber: selectedWeekNumber,
        }),
      previousFeaturedEntry: localContinueFeaturedEntry ?? continuePayload?.previousFeaturedEntry ?? null,
    }
  }, [continuePayload?.previousFeaturedEntry, currentSubject, localContinueFeaturedEntry, materials, selectedPracticeMaterial, selectedWeekNumber, subjectDialogDateKey])
  const reviewEntriesByWeek = useMemo(() => {
    return reviewEntries.reduce<Record<number, SubjectDayEntry[]>>((accumulator, entry) => {
      const current = accumulator[entry.week_number] ?? []
      current.push(entry)
      accumulator[entry.week_number] = current
      return accumulator
    }, {})
  }, [reviewEntries])
  const practiceWeekOptions = useMemo(
    () => Array.from({ length: currentCalendarWeek + 1 }, (_, index) => String(index)),
    [currentCalendarWeek]
  )

  const handleReset = async () => {
    try {
      const scheduledSubjects = getDisplaySubjectsForDate(selectedDate, showAllSubjectsForDay, visibleSubjects)
      const scheduledSubjectIds = scheduledSubjects.map((subject) => subject.id)
      
      // Reset local state
      setActiveSubjects(scheduledSubjects)
      setCompletedSubjects([])
      setAllCompletedSubjectIds([])
      setHistory([])
      setHistoryIndex(-1)

      // Delete today's session from database
      await fetch("/api/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          date: currentDateKey,
          activeSubjectIds: scheduledSubjectIds,
          completedSubjects: {},
          showAllSubjects: showAllSubjectsForDay,
        }),
      })
    } catch (error) {
      console.error("[v0] Failed to reset:", error)
    }
  }

  const handleShowAllSubjectsChange = (checked: boolean) => {
    const nextCompletedIds = checked
      ? allCompletedSubjectIds
      : allCompletedSubjectIds.filter((subjectId) => getDisplaySubjectIdsForDate(selectedDate, false, visibleSubjectIds).includes(subjectId))

    setShowAllSubjectsForDay(checked)
    setAllCompletedSubjectIds(nextCompletedIds)
    const normalized = normalizeSubjectsForDay(nextCompletedIds, selectedDate, checked, visibleSubjects)
    setActiveSubjects(normalized.activeSubjects)
    setCompletedSubjects(normalized.completedSubjects)
    setHistory([])
    setHistoryIndex(-1)

    if (!checked && isDialogOpen && practiceSectionView === "exercises") {
      if (currentSubject && !getDisplaySubjectIdsForDate(selectedDate, false, visibleSubjectIds).includes(currentSubject.id)) {
        void closeSubjectDialog()
      } else {
        setExerciseWeeklyScopeEnabled(false)
      }
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
            onClick={openManualMobileShortcutPicker}
            variant="outline"
            className="h-9 px-3"
          >
            <Smartphone className="w-4 h-4 mr-1.5" />
            Celular
          </Button>
          <Button
            onClick={openPracticeModal}
            variant="outline"
            className="h-9 px-3"
          >
            <GraduationCap className="w-4 h-4 mr-1.5" />
            Practicar
          </Button>
          <Button
            onClick={openReviewModal}
            variant="outline"
            className="h-9 px-3"
          >
            Destacado
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

      {authSession.isAdmin ? (
        <AdminAccessModal open={isAdminModalOpen} onOpenChange={setIsAdminModalOpen} subjectOptions={SUBJECTS} />
      ) : null}

      <Dialog open={isMobileShortcutPickerOpen} onOpenChange={setIsMobileShortcutPickerOpen}>
        <DialogContent showCloseButton={false} className="sm:max-w-md">
          <DialogHeader>
            <div className="flex items-start justify-between gap-4">
              <div className="space-y-1">
                <DialogTitle>Elegir materia</DialogTitle>
                <DialogDescription>Selecciona una de las materias disponibles para abrir el modal del celular.</DialogDescription>
              </div>
              <DialogClose asChild>
                <button
                  type="button"
                  className="flex h-14 w-14 items-center justify-center rounded-full border-2 border-black text-black transition-colors hover:bg-black hover:text-white"
                  aria-label="Cerrar modal"
                >
                  <X className="h-7 w-7" />
                </button>
              </DialogClose>
            </div>
          </DialogHeader>

          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {visibleSubjects.map((subject) => (
              <button
                key={subject.id}
                type="button"
                onClick={() => handleManualMobileSubjectSelect(subject.id)}
                className="rounded-xl border border-slate-300 px-4 py-3 text-left text-sm font-medium text-slate-900 transition hover:border-slate-500 hover:bg-slate-50"
              >
                {subject.name.replace("\n", " ")}
              </button>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={isMobileShortcutOpen} onOpenChange={(open) => (!open ? closeMobileShortcutModal(true) : undefined)}>
        <DialogContent
          className="top-0 left-0 z-[60] h-dvh w-screen max-w-none translate-x-0 translate-y-0 gap-0 rounded-none border-0 bg-[#9a9a9a] p-0 shadow-none sm:top-1/2 sm:left-1/2 sm:h-[min(92dvh,760px)] sm:w-[440px] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-[28px] sm:border-2 sm:border-slate-200 sm:shadow-2xl"
          showCloseButton={false}
          onPointerDownOutside={(event) => event.preventDefault()}
          onInteractOutside={(event) => event.preventDefault()}
          onEscapeKeyDown={(event) => event.preventDefault()}
        >
          <DialogHeader className="sr-only">
            <DialogTitle>Atajo de celular</DialogTitle>
            <DialogDescription>Modal para grabar y confirmar un audio rápido.</DialogDescription>
          </DialogHeader>

          <div className="flex h-full min-h-0 flex-col justify-between bg-[#9a9a9a] px-6 py-6 text-slate-950 sm:rounded-[26px]">
            <div className="space-y-8 pt-2">
              <div className="mx-auto flex h-28 w-full max-w-[320px] items-center justify-center rounded-[18px] border-[8px] border-slate-700 bg-[#afafaf] text-6xl font-medium text-white">
                {mobileClockLabel}
              </div>

              <div className="space-y-5 text-center">
                <p className="text-3xl font-semibold text-slate-950">
                  {activeMobileModalTarget ? activeMobileModalTarget.subjectName : "Esperando horario"}
                </p>
                <button
                  type="button"
                  onClick={() => {
                    if (!activeMobileModalTarget) return

                    void (
                      isRecording && (recordingTarget?.source === "mobile-shortcut" || recordingTarget?.source === "manual-mobile-shortcut")
                        ? stopRecording()
                        : startRecording(activeMobileModalTarget)
                    )
                  }}
                  disabled={!activeMobileModalTarget || isUploadingAudio}
                  className={`mx-auto flex h-52 w-52 items-center justify-center rounded-full border-[8px] border-slate-700 transition ${
                    !activeMobileModalTarget || isUploadingAudio
                      ? "cursor-not-allowed opacity-50"
                      : isRecording && (recordingTarget?.source === "mobile-shortcut" || recordingTarget?.source === "manual-mobile-shortcut")
                        ? "bg-red-500 text-white"
                        : "bg-[#9a9a9a] text-slate-950 hover:bg-[#a3a3a3]"
                  }`}
                  aria-label={isRecording && (recordingTarget?.source === "mobile-shortcut" || recordingTarget?.source === "manual-mobile-shortcut") ? "Detener grabacion" : "Iniciar grabacion"}
                >
                  {isRecording && (recordingTarget?.source === "mobile-shortcut" || recordingTarget?.source === "manual-mobile-shortcut") ? (
                    <Square className="h-20 w-20" />
                  ) : (
                    <Mic className="h-20 w-20" />
                  )}
                </button>
              </div>
            </div>

            <div className="space-y-3 pb-1">
              {reviewAudio && (recordingTarget?.source === "mobile-shortcut" || recordingTarget?.source === "manual-mobile-shortcut") ? (
                <audio controls src={reviewAudio.url} className="w-full" />
              ) : (
                <div className="h-12 rounded-full border-4 border-slate-700/70 bg-[#9a9a9a]" />
              )}

              {recordingError ? <div className="text-sm text-red-900">{recordingError}</div> : null}
              {entriesError && (recordingTarget?.source === "mobile-shortcut" || recordingTarget?.source === "manual-mobile-shortcut") ? (
                <div className="text-sm text-red-900">{entriesError}</div>
              ) : null}
              {!activeMobileModalTarget ? (
                <p className="text-sm text-slate-900">
                  Este modal se abre solo en los bloques definidos. El boton queda disponible para la fase 1.
                </p>
              ) : null}

              <div className="flex items-center justify-between gap-4 pt-2 text-[2rem] font-medium leading-none text-slate-700">
                <button
                  type="button"
                  onClick={handleMobileShortcutReset}
                  disabled={isUploadingAudio || (!reviewAudio && !(isRecording && (recordingTarget?.source === "mobile-shortcut" || recordingTarget?.source === "manual-mobile-shortcut")))}
                  className="transition disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Reiniciar
                </button>
                <button
                  type="button"
                  onClick={() => void confirmReview()}
                  disabled={!reviewAudio || !recordingTarget || !["mobile-shortcut", "manual-mobile-shortcut"].includes(recordingTarget.source) || isUploadingAudio}
                  className="transition disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {isUploadingAudio ? "Subiendo..." : "Confirmar"}
                </button>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>

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

      <Dialog open={isNextWeekDialogOpen} onOpenChange={setIsNextWeekDialogOpen}>
        <DialogContent className="max-w-md border-2 border-black bg-white text-black">
          <DialogHeader className="space-y-2 text-left">
            <DialogTitle>Comenzar siguiente semana</DialogTitle>
            <DialogDescription className="text-sm text-slate-700">
              Adelanta la vista a la proxima semana para cargar material antes del lunes cuando ya este habilitado.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="sm:justify-start">
            <Button
              type="button"
              onClick={() => void startNextWeek()}
              disabled={selectedWeekNumber >= currentCalendarWeek + 1}
              className="border-2 border-black bg-black text-white hover:bg-slate-900"
            >
              Comenzar semana {currentCalendarWeek + 1}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={isDialogOpen} onOpenChange={(open) => (!open ? void closeSubjectDialogOrReturn() : undefined)}>
        <DialogContent className="h-[100dvh] w-screen max-w-none border-0 bg-white p-0 shadow-none sm:h-[96vh] sm:w-[98vw] sm:max-w-[98vw] sm:border-2 sm:border-black" showCloseButton={false}>
          <div className="relative flex h-full flex-col overflow-hidden px-4 py-4 sm:p-8">
            <Button
              variant="outline"
              size="icon"
              onClick={() => void (practiceSectionView === "exercises" && !subjectViewDateOverride ? moveWeek(-1) : moveDay(-1))}
              disabled={
                practiceSectionView === "exercises" && !subjectViewDateOverride
                  ? selectedWeekNumber <= 0
                  : subjectDialogDayIndex <= 0
              }
              className="absolute left-3 top-1/2 z-20 flex h-10 w-10 -translate-y-1/2 rounded-full border-2 border-black bg-white text-black opacity-70 hover:opacity-100 disabled:opacity-25 sm:h-12 sm:w-12"
            >
              <ChevronLeft className="h-5 w-5" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              onClick={() => void (practiceSectionView === "exercises" && !subjectViewDateOverride ? moveWeek(1) : moveDay(1))}
              disabled={
                practiceSectionView === "exercises" && !subjectViewDateOverride
                  ? selectedWeekNumber >= latestWeekNumber
                  : subjectDialogDayIndex === -1 || subjectDialogDayIndex >= lastVisibleDayIndex
              }
              className="absolute right-3 top-1/2 z-20 flex h-10 w-10 -translate-y-1/2 rounded-full border-2 border-black bg-white text-black opacity-70 hover:opacity-100 disabled:opacity-25 sm:h-12 sm:w-12"
            >
              <ChevronRight className="h-5 w-5" />
            </Button>

            <DialogHeader className="space-y-3 border-b border-black pb-3 sm:border-b-2 sm:pb-4 sm:pr-28">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 space-y-1.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <DialogTitle className="text-left text-[clamp(1.55rem,4.8vw,2.3rem)] font-normal leading-tight text-black">
                      {practiceSectionView === "exercises"
                        ? subjectViewDateOverride
                          ? `Semana ${selectedWeekNumber} - ${getSubjectDisplayName(currentSubject)} - ${getWeekdayLabel(subjectDialogDateKey)}`
                          : `Semana ${selectedWeekNumber} - ${getSubjectDisplayName(currentSubject)}`
                        : `Semana ${selectedWeekNumber} - ${getSubjectDisplayName(currentSubject)} - ${getWeekdayLabel(currentDateKey)}`}
                    </DialogTitle>
                    {practiceSectionView === "theory" ? (
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
                    ) : null}
                    {practiceSectionView === "exercises" && subjectViewDateOverride ? (
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => void returnToCurrentDayView()}
                        className="h-9 border-black px-3 text-black"
                      >
                        Volver
                      </Button>
                    ) : null}
                  </div>
                  <DialogDescription className="text-left text-sm text-black sm:text-base">
                    {practiceSectionView === "exercises"
                      ? isWeeklyExercisesScope
                        ? "Practica de toda la semana por archivo"
                        : "Teoria y practica por archivo"
                      : "Flujo anterior de dudas"}
                  </DialogDescription>
                </div>

                <div className="flex items-start gap-3">
                  {practiceSectionView === "theory" ? (
                    <Button
                      type="button"
                      onClick={() => currentSubject && markSubjectAsCompleted(currentSubject)}
                      className="h-10 rounded-2xl border-2 border-black bg-white px-4 text-sm text-black hover:bg-slate-100 sm:h-11 sm:px-6"
                    >
                      Terminar
                    </Button>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => void closeSubjectDialogOrReturn()}
                    className="flex h-14 w-14 items-center justify-center rounded-full border-2 border-black bg-white text-black transition-colors hover:bg-black hover:text-white"
                    aria-label="Cerrar modal"
                  >
                    <X className="h-7 w-7" />
                  </button>
                </div>
              </div>

              {practiceSectionView === "theory" ? (
                <div className="text-sm text-slate-700 sm:text-base">{currentDateKey}</div>
              ) : subjectViewDateOverride ? (
                <div className="text-sm text-slate-700 sm:text-base">{subjectDialogDateKey}</div>
              ) : null}
            </DialogHeader>

            <div className="flex-1 overflow-y-auto py-4 pr-1 sm:py-6 sm:pl-14 sm:pr-14">
              <input
                ref={theoryFileInputRef}
                type="file"
                accept="application/pdf"
                className="hidden"
                onChange={(event) => void handleMaterialUpload("theory", event.target.files?.[0] ?? null)}
              />
              <input
                ref={practiceFileInputRef}
                type="file"
                accept="application/pdf"
                className="hidden"
                onChange={(event) => void handleMaterialUpload("practice", event.target.files?.[0] ?? null)}
              />

              {entriesError ? (
                <div className="mb-3 border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">{entriesError}</div>
              ) : null}

              {practiceSectionView === "theory" ? (
                <div className="mb-2" />
              ) : (
                <>
                <div className="mb-6 space-y-4">
                  <section className="space-y-3 border border-slate-300 bg-slate-50 p-4">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-xs font-medium uppercase tracking-[0.18em] text-slate-500">Teoria</p>
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => theoryFileInputRef.current?.click()}
                        disabled={isUploadingMaterialType !== null}
                        className="border-black text-black"
                      >
                        {isUploadingMaterialType === "theory" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                      </Button>
                    </div>

                    <div className="space-y-2">
                      {theoryMaterials.length > 0 ? (
                        theoryMaterials.map((material) => (
                          "is_pending_upload" in material ? (
                            <div
                              key={material.id}
                              className="flex items-center justify-between gap-3 border border-slate-200 bg-white px-3 py-2 text-sm text-slate-500"
                            >
                              <span className="truncate">{material.file_name}</span>
                              <span className="inline-flex items-center gap-2 text-xs">
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                Subiendo...
                              </span>
                            </div>
                          ) : (
                            <div key={material.id} className="relative flex items-center gap-3 border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 hover:bg-slate-50">
                              <a
                                href={buildPracticeDefaultViewerHref(material.id)}
                                className="min-w-0 flex-1 truncate pr-7"
                                onPointerDown={() => prefetchPracticeViewer(material)}
                                onTouchStart={() => prefetchPracticeViewer(material)}
                              >
                                <span className="truncate">{material.file_name}</span>
                              </a>
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                onClick={() => void deleteMaterial(material)}
                                disabled={isDeletingMaterialId === material.id}
                                className="absolute right-1.5 top-1.5 h-6 w-6 rounded-full text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                                aria-label={`Borrar ${material.file_name}`}
                              >
                                {isDeletingMaterialId === material.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <X className="h-3.5 w-3.5" />}
                              </Button>
                            </div>
                          )
                        ))
                      ) : null}
                    </div>
                  </section>

                  <section className="space-y-3 border border-slate-300 bg-slate-50 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <p className="text-xs font-medium uppercase tracking-[0.18em] text-slate-500">Practica</p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          onClick={() => {
                            if (!currentSubject) return
                            window.open(
                              buildPracticeDraftViewerHref({
                                subjectId: currentSubject.id,
                                subjectName: getSubjectDisplayName(currentSubject),
                                sessionDate: subjectDialogDateKey,
                                weekNumber: selectedWeekNumber,
                                weekdayIndex: subjectDialogDayIndex >= 0 ? subjectDialogDayIndex : 0,
                              }),
                              "_blank",
                              "noopener,noreferrer"
                            )
                          }}
                          disabled={isUploadingMaterialType !== null || !currentSubject}
                          className="border-black text-black"
                          aria-label="Abrir visor para fragmentar un libro"
                        >
                          <ExternalLink className="h-4 w-4" />
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          onClick={() => practiceFileInputRef.current?.click()}
                          disabled={isUploadingMaterialType !== null}
                          className="border-black text-black"
                        >
                          {isUploadingMaterialType === "practice" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                        </Button>
                        <Button
                          type="button"
                          onClick={() => void openContinueModal()}
                          className="border-black bg-black text-white"
                        >
                          Continuar
                        </Button>
                      </div>
                    </div>

                    <div className="space-y-2">
                      {practiceMaterials.length > 0 ? (
                        practiceMaterials.map((material) => (
                          <div key={material.id} className="flex items-center justify-between gap-3 border border-slate-200 bg-white px-3 py-2">
                            {"is_pending_upload" in material ? (
                              <>
                                <span className="inline-flex min-w-0 flex-1 items-center gap-2 truncate text-sm text-slate-500">
                                  <Checkbox checked={false} disabled />
                                  <span className="truncate">{material.file_name}</span>
                                </span>
                                {isWeeklyExercisesScope ? (
                                  <span className="shrink-0 text-xs text-slate-400">
                                    {getWeekdayLabel(material.session_date)} {material.session_date}
                                  </span>
                                ) : null}
                                <span className="inline-flex items-center gap-2 text-xs text-slate-500">
                                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                  Subiendo...
                                </span>
                              </>
                            ) : (
                              <>
                                <Checkbox
                                  checked={material.is_checkup_done}
                                  onCheckedChange={(checked) => void toggleMaterialCheckup(material, Boolean(checked))}
                                />
                                <a
                                  href={buildPracticeDefaultViewerHref(material.id)}
                                  className="min-w-0 flex-1 truncate pr-7 text-sm text-slate-800 hover:underline"
                                  onPointerDown={() => prefetchPracticeViewer(material)}
                                  onTouchStart={() => prefetchPracticeViewer(material)}
                                >
                                  {material.file_name}
                                </a>
                                <Button
                                  type="button"
                                  variant="outline"
                                  onClick={() => void openContinueModal(material.id)}
                                  className="h-8 border-black px-3 text-xs text-black"
                                >
                                  Ver
                                </Button>
                                <Button
                                  type="button"
                                  variant="outline"
                                  onClick={() => void copyEntriesForMaterial(material.id)}
                                  disabled={(practiceEntriesByMaterialId[material.id] ?? []).length === 0 || isCopyingEntries}
                                  className="h-8 border-black px-3 text-xs text-black"
                                >
                                  Copiar
                                </Button>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon"
                                  onClick={() => void deleteMaterial(material)}
                                  disabled={isDeletingMaterialId === material.id}
                                  className="h-6 w-6 rounded-full text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                                  aria-label={`Borrar ${material.file_name}`}
                                >
                                  {isDeletingMaterialId === material.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <X className="h-3.5 w-3.5" />}
                                </Button>
                              </>
                            )}
                          </div>
                        ))
                      ) : (
                        <p className="border border-dashed border-slate-300 bg-white px-3 py-4 text-sm text-slate-500">
                          Todavia no hay PDFs de practica para este dia.
                        </p>
                      )}
                    </div>
                  </section>

                  <section className="space-y-3 border border-slate-300 bg-slate-50 p-4">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-xs font-medium uppercase tracking-[0.18em] text-slate-500">Semana</p>
                      </div>
                    </div>

                    <div className="space-y-2">
                      {weekAudioDays.length > 0 ? (
                        weekAudioDays.map((day) => (
                          <div key={day.sessionDate} className="flex items-center justify-between gap-3 border border-slate-200 bg-white px-3 py-2">
                            <span className="min-w-0 flex-1 truncate text-sm text-slate-800">
                              {getWeekdayLabel(day.sessionDate)}
                            </span>
                            <Button
                              type="button"
                              variant="outline"
                              onClick={() => void openWeekAudioDay(day.sessionDate)}
                              className="h-8 border-black px-3 text-xs text-black"
                            >
                              Ver
                            </Button>
                            <Button
                              type="button"
                              variant="outline"
                              onClick={() => void copyEntriesForSession(day.sessionDate)}
                              disabled={day.entries.length === 0 || isCopyingEntries}
                              className="h-8 border-black px-3 text-xs text-black"
                            >
                              Copiar
                            </Button>
                          </div>
                        ))
                      ) : (
                        <p className="border border-dashed border-slate-300 bg-white px-3 py-4 text-sm text-slate-500">
                          Todavia no hay audios cargados en esta semana.
                        </p>
                      )}
                    </div>
                  </section>
                </div>
                </>
              )}

              {isEntriesLoading || isMaterialsLoading ? (
                <div className="flex min-h-56 items-center justify-center">
                  <Loader2 className="h-6 w-6 animate-spin text-slate-500" />
                </div>
              ) : practiceSectionView === "theory" && theoryDayEntries.length > 0 ? (
                <div className="space-y-3 pb-24 sm:space-y-4 sm:pb-28">
                  {theoryDayEntries.map((entry) => {
                    const isRevealed = revealedAnswers[entry.id]
                    const isExpandedAudio = expandedAudioEntryId === entry.id
                    const audioSrc = audioSourceUrls[entry.id]
                    const isEditingTitle = editingTitleId === entry.id

                    return (
                      <article key={entry.id} className="relative border border-slate-300 px-3 py-3 sm:px-4">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          onClick={() => void deleteEntry(entry)}
                          disabled={isDeletingEntryId === entry.id}
                          className="absolute right-1.5 top-1.5 h-6 w-6 rounded-full text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                          aria-label={`Borrar ${getEntryDisplayTitle(entry)}`}
                        >
                          {isDeletingEntryId === entry.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <X className="h-3.5 w-3.5" />}
                        </Button>
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
                              <div className="flex flex-wrap items-center gap-2 pr-8">
                                <Checkbox
                                  checked={entry.is_featured}
                                  onCheckedChange={() => void toggleFeaturedEntry(entry)}
                                  className="h-4 w-4"
                                />
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

                          {entryHasAudio(entry) ? (
                            <Button variant="outline" onClick={() => void togglePlayback(entry.id)} className="h-10 shrink-0 border-black px-3 text-black sm:px-4">
                              {loadingAudioEntryId === entry.id ? <Loader2 className="h-4 w-4 animate-spin" /> : isExpandedAudio ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                              {loadingAudioEntryId === entry.id ? "Cargando..." : isExpandedAudio ? "Reproducir/Pausar" : "Audio"}
                            </Button>
                          ) : null}
                        </div>

                        {entryHasAudio(entry) && isExpandedAudio && audioSrc ? (
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
              ) : practiceSectionView === "theory" ? (
                <div className="pb-24 text-sm text-slate-700 sm:pb-28"></div>
              ) : (
                <div className="pb-24 sm:pb-28"></div>
              )}

              {recordingError ? (
                <div className="mt-3 pr-24 text-sm text-red-700">{recordingError}</div>
              ) : null}
              {isRecording ? (
                <div className="mt-3 pr-24 text-sm text-slate-700">Grabando...</div>
              ) : null}
            </div>

            <div className="relative h-0">
              <div
                className={`absolute bottom-4 right-2 flex flex-col items-center gap-3 sm:right-4 ${
                  practiceSectionView !== "theory" ? "pointer-events-none opacity-0" : ""
                }`}
              >
                <button
                  type="button"
                  onClick={() => {
                    if (practiceSectionView !== "theory") return
                    if (!currentSubject) return

                    const target: AudioUploadTarget = {
                      source: "subject-dialog",
                      subjectId: currentSubject.id,
                      subjectName: getSubjectDisplayName(currentSubject),
                      sessionDate: currentDateKey,
                      weekNumber: selectedWeekNumber,
                      weekdayIndex: currentDayIndex >= 0 ? currentDayIndex : 0,
                    }

                    void (isRecording ? stopRecording() : startRecording(target))
                  }}
                  className={`flex h-16 w-16 items-center justify-center rounded-full border-2 border-black shadow-sm sm:h-20 sm:w-20 ${
                    isRecording ? "bg-red-500 text-white" : "bg-white text-black"
                  }`}
                  aria-label={isRecording ? "Detener grabacion" : "Iniciar grabacion"}
                  disabled={practiceSectionView !== "theory"}
                >
                  {isRecording ? <Square className="h-8 w-8 sm:h-10 sm:w-10" /> : <Mic className="h-8 w-8 sm:h-10 sm:w-10" />}
                </button>

                <button
                  type="button"
                  onClick={() => {
                    if (practiceSectionView !== "theory") return
                    if (!currentSubject) return

                    startManualEntry({
                      subjectId: currentSubject.id,
                      sessionDate: currentDateKey,
                      weekNumber: selectedWeekNumber,
                      weekdayIndex: currentDayIndex >= 0 ? currentDayIndex : 0,
                    })
                  }}
                  className="flex h-12 w-12 items-center justify-center rounded-full border-2 border-black bg-white text-black shadow-sm sm:h-14 sm:w-14"
                  aria-label="Escribir duda"
                  disabled={practiceSectionView !== "theory"}
                >
                  <FilePenLine className="h-5 w-5 sm:h-6 sm:w-6" />
                </button>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={isContinueOpen}
        onOpenChange={(open) => {
          setIsContinueOpen(open)
          if (!open) {
            setSelectedPracticeMaterialId(null)
          }
        }}
      >
        <DialogContent
          showCloseButton={false}
          className="!top-0 !left-0 !h-screen !w-screen !max-w-none !translate-x-0 !translate-y-0 overflow-y-auto rounded-none border-0 p-0 shadow-none sm:!max-w-none"
        >
          <div className="relative min-h-full bg-white px-5 py-5 sm:px-8 sm:py-6">
            <DialogHeader className="mb-6 border-b border-black pb-4">
              <div className="flex items-start justify-between gap-4">
                <DialogTitle className="text-left text-[2rem] font-normal leading-none text-black sm:text-[2.5rem]">
                  Continuar
                </DialogTitle>
                <DialogClose asChild>
                  <button
                    type="button"
                    className="flex h-14 w-14 items-center justify-center rounded-full border-2 border-black text-black transition-colors hover:bg-black hover:text-white"
                    aria-label="Cerrar modal"
                  >
                    <X className="h-7 w-7" />
                  </button>
                </DialogClose>
              </div>
            </DialogHeader>

            {continueError ? (
              <div className="mb-4 border border-red-300 bg-red-50 px-4 py-3 text-base text-red-700">{continueError}</div>
            ) : null}

            {isContinueLoading ? (
              <div className="flex min-h-40 items-center justify-center">
                <Loader2 className="h-6 w-6 animate-spin text-slate-500" />
              </div>
            ) : (
              <div className="space-y-8 pb-24">
                <section className="space-y-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                    {continuePayload?.previousFeaturedEntry ? (
                      <div className="w-full min-w-0 flex-1 overflow-hidden rounded-xl border border-slate-300 bg-white px-2 py-2">
                        <audio
                          key={continuePayload.previousFeaturedEntry.id}
                          controls
                          preload="none"
                          src={`/api/subject-day-entries/${continuePayload.previousFeaturedEntry.id}/audio`}
                          className="block w-full min-w-0"
                        />
                      </div>
                    ) : (
                      <div className="flex h-12 w-full items-center border border-dashed border-slate-300 px-4 text-base text-slate-400">
                        Sin audio previo
                      </div>
                    )}
                    <Button
                      type="button"
                      variant="outline"
                      className="h-12 border-black px-5 text-base text-black"
                      onClick={() => {
                        if (!currentSubject) return

                  const target: AudioUploadTarget = {
                    source: "continue-context",
                    subjectId: currentSubject.id,
                    subjectName: getSubjectDisplayName(currentSubject),
                    sessionDate: subjectDialogDateKey,
                    weekNumber: selectedWeekNumber,
                    weekdayIndex: subjectDialogDayIndex >= 0 ? subjectDialogDayIndex : 0,
                  }

                        void (isRecording ? stopRecording() : startRecording(target))
                      }}
                    >
                      {isRecording && recordingTarget?.source === "continue-context" ? (
                        <Square className="h-5 w-5" />
                      ) : (
                        <RotateCcw className="h-5 w-5" />
                      )}
                      reset
                    </Button>
                  </div>
                </section>

                <section className="space-y-5">
                  <div className="space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <p className="text-lg text-black">Archivo actual</p>
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => void copyContinueEntries()}
                        disabled={continueMaterialEntries.length === 0 || isCopyingEntries}
                        className="h-10 border-black px-3 text-black"
                      >
                        {isCopyingEntries ? <Loader2 className="h-4 w-4 animate-spin" /> : <Copy className="h-4 w-4" />}
                        Copiar dudas
                      </Button>
                    </div>
                    {currentContinueMaterial ? (
                      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-300 px-4 py-3 text-lg text-black">
                        <Checkbox
                          checked={currentContinueMaterial.is_checkup_done}
                          onCheckedChange={(checked) => void toggleMaterialCheckup(currentContinueMaterial, Boolean(checked))}
                        />
                        <a
                          href={buildPracticeDefaultViewerHref(currentContinueMaterial.id)}
                          className="font-medium underline-offset-2 hover:underline"
                          onPointerDown={() => prefetchPracticeViewer(currentContinueMaterial)}
                          onTouchStart={() => prefetchPracticeViewer(currentContinueMaterial)}
                        >
                          {currentContinueMaterial.file_name}
                        </a>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          onClick={() => void deleteMaterial(currentContinueMaterial)}
                          disabled={isDeletingMaterialId === currentContinueMaterial.id}
                          className="ml-auto h-6 w-6 rounded-full text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                          aria-label={`Borrar ${currentContinueMaterial.file_name}`}
                        >
                          {isDeletingMaterialId === currentContinueMaterial.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <X className="h-3.5 w-3.5" />}
                        </Button>
                      </div>
                    ) : (
                      <p className="text-base text-slate-500">No hay archivos de practica pendientes.</p>
                    )}
                  </div>

                  {continueMaterialEntries.length > 0 ? (
                    <div className="space-y-5">
                      {continueMaterialEntries.map((entry) => {
                        const isExpandedAudio = expandedAudioEntryId === entry.id
                        const audioSrc = audioSourceUrls[entry.id]
                        const isEditingTitle = editingTitleId === entry.id
                        const isRevealed = revealedAnswers[entry.id]

                        return (
                          <article key={entry.id} className="relative space-y-3 border-t border-slate-200 pt-5">
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              onClick={() => void deleteEntry(entry)}
                              disabled={isDeletingEntryId === entry.id}
                              className="absolute right-0 top-4 h-6 w-6 rounded-full text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                              aria-label={`Borrar ${getEntryDisplayTitle(entry)}`}
                            >
                              {isDeletingEntryId === entry.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <X className="h-3.5 w-3.5" />}
                            </Button>
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
                                  className="h-10 max-w-sm text-base"
                                />
                                <Button size="sm" onClick={() => void saveTitle(entry)} disabled={isSavingTitleId === entry.id}>
                                  {isSavingTitleId === entry.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                                </Button>
                                <Button size="sm" variant="outline" onClick={() => setEditingTitleId(null)}>
                                  <X className="h-4 w-4" />
                                </Button>
                              </div>
                            ) : (
                              <div className="flex flex-wrap items-center gap-2 pr-8 text-black">
                                <p className="text-lg font-medium">{getEntryDisplayTitle(entry)}</p>
                                <Button size="icon" variant="ghost" onClick={() => startTitleEdit(entry)} className="h-8 w-8">
                                  <Pencil className="h-4 w-4" />
                                </Button>
                              </div>
                            )}

                            <p className="text-base leading-7 text-slate-800">{entry.transcript_text}</p>

                            <button
                              type="button"
                              onClick={() => {
                                if (!entry.answer_text) {
                                  startAnswerEdit(entry)
                                  return
                                }
                                setRevealedAnswers((previous) => ({
                                  ...previous,
                                  [entry.id]: !previous[entry.id],
                                }))
                              }}
                              className="block w-full rounded-lg border border-slate-300 px-4 py-3 text-left text-base text-slate-700"
                            >
                              {entry.answer_text
                                ? isRevealed
                                  ? entry.answer_text
                                  : "Click para revelar la respuesta"
                                : "Escribir respuesta"}
                            </button>

                            <div className="flex flex-wrap items-center gap-2">
                              <Button variant="outline" onClick={() => startAnswerEdit(entry)} className="h-11 border-black px-4 text-base text-black">
                                Responder
                              </Button>
                              {entryHasAudio(entry) ? (
                                <Button variant="outline" onClick={() => void togglePlayback(entry.id)} className="h-11 border-black px-4 text-base text-black">
                                  {loadingAudioEntryId === entry.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                                  audio
                                </Button>
                              ) : null}
                            </div>

                            {entryHasAudio(entry) && isExpandedAudio && audioSrc ? (
                              <audio
                                ref={(element) => {
                                  audioElementRefs.current[entry.id] = element
                                }}
                                controls
                                src={audioSrc}
                                preload="metadata"
                                className="h-12 w-full"
                              />
                            ) : null}
                          </article>
                        )
                      })}
                    </div>
                  ) : currentContinueMaterial ? (
                    <p className="text-base text-slate-500">Sin audios.</p>
                  ) : null}
                </section>
              </div>
            )}

            <div className="pointer-events-none absolute bottom-4 right-4">
              <div className="pointer-events-auto flex flex-col items-center gap-3">
                <button
                  type="button"
                  onClick={() => {
                    if (!currentSubject || !currentContinueMaterial) return

                    const target: AudioUploadTarget = {
                      source: "continue-practice",
                      subjectId: currentSubject.id,
                      subjectName: getSubjectDisplayName(currentSubject),
                      sessionDate: subjectDialogDateKey,
                      weekNumber: selectedWeekNumber,
                      weekdayIndex: subjectDialogDayIndex >= 0 ? subjectDialogDayIndex : 0,
                      materialId: currentContinueMaterial.id,
                    }

                    void (isRecording ? stopRecording() : startRecording(target))
                  }}
                  className="flex h-16 w-16 items-center justify-center rounded-full border-2 border-black bg-white text-black shadow-sm"
                  aria-label={isRecording && recordingTarget?.source === "continue-practice" ? "Detener grabacion" : "Grabar audio"}
                  disabled={!currentContinueMaterial}
                >
                  {isRecording && recordingTarget?.source === "continue-practice" ? (
                    <Square className="h-8 w-8" />
                  ) : (
                    <Mic className="h-8 w-8" />
                  )}
                </button>

                <button
                  type="button"
                  onClick={() => {
                    if (!currentSubject || !currentContinueMaterial) return

                    startManualEntry({
                      subjectId: currentSubject.id,
                      sessionDate: subjectDialogDateKey,
                      weekNumber: selectedWeekNumber,
                      weekdayIndex: subjectDialogDayIndex >= 0 ? subjectDialogDayIndex : 0,
                      materialId: currentContinueMaterial.id,
                    })
                  }}
                  className="flex h-12 w-12 items-center justify-center rounded-full border-2 border-black bg-white text-black shadow-sm"
                  aria-label="Escribir duda"
                  disabled={!currentContinueMaterial}
                >
                  <FilePenLine className="h-5 w-5" />
                </button>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(editingEntry || manualEntryTarget)} onOpenChange={(open) => (!open ? closeAnswerDialog() : undefined)}>
        <DialogContent showCloseButton={false} className="flex max-h-[92dvh] flex-col overflow-hidden sm:max-w-lg">
          <DialogHeader>
            <div className="flex items-start justify-between gap-4">
              <div className="space-y-1">
                <DialogTitle>Responder</DialogTitle>
                <DialogDescription>
                  {manualEntryTarget
                    ? "Escribe la duda y, si quieres, su respuesta. Al guardar se crea una nueva duda."
                    : "Escribe la respuesta para esta duda. Luego quedara oculta hasta hacer click."}
                </DialogDescription>
              </div>
              <DialogClose asChild>
                <button
                  type="button"
                  className="flex h-14 w-14 items-center justify-center rounded-full border-2 border-black text-black transition-colors hover:bg-black hover:text-white"
                  aria-label="Cerrar modal"
                >
                  <X className="h-7 w-7" />
                </button>
              </DialogClose>
            </div>
          </DialogHeader>

          {editingEntry || manualEntryTarget ? (
            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
              <div className="space-y-2">
                <p className="text-sm font-medium text-slate-700">Pregunta</p>
                <Textarea
                  value={editingEntry ? (questionDrafts[editingEntry.id] ?? editingEntry.transcript_text) : manualQuestionDraft}
                  onChange={(event) => {
                    if (editingEntry) {
                      setQuestionDrafts((previous) => ({
                        ...previous,
                        [editingEntry.id]: event.target.value,
                      }))
                      return
                    }

                    setManualQuestionDraft(event.target.value)
                  }}
                  placeholder="Escribe la duda"
                  className="min-h-[220px] resize-y sm:min-h-24"
                />
              </div>
              <div className="space-y-2">
                <p className="text-sm font-medium text-slate-700">Respuesta</p>
                <Textarea
                  value={editingEntry ? (answerDrafts[editingEntry.id] ?? "") : manualAnswerDraft}
                  onChange={(event) => {
                    if (editingEntry) {
                      setAnswerDrafts((previous) => ({
                        ...previous,
                        [editingEntry.id]: event.target.value,
                      }))
                      return
                    }

                    setManualAnswerDraft(event.target.value)
                  }}
                  placeholder="Escribe la respuesta"
                  className="min-h-[180px] resize-y sm:min-h-32"
                />
              </div>
            </div>
          ) : null}

          <DialogFooter className="mt-4 border-t border-slate-200 pt-4">
            <Button variant="outline" onClick={closeAnswerDialog}>
              Cancelar
            </Button>
            <Button
              onClick={() => (editingEntry ? void saveAnswer(editingEntry) : void saveManualEntry())}
              disabled={isSavingAnswerId === (editingEntry?.id ?? -1)}
            >
              {isSavingAnswerId === (editingEntry?.id ?? -1) ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
              Guardar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={isReviewDialogOpen} onOpenChange={(open) => (!open ? cancelReview() : undefined)}>
        <DialogContent
          showCloseButton={false}
          className="sm:max-w-lg"
          onPointerDownOutside={(event) => event.preventDefault()}
          onInteractOutside={(event) => event.preventDefault()}
          onEscapeKeyDown={(event) => event.preventDefault()}
        >
          <DialogHeader>
            <div className="flex items-start justify-between gap-4">
              <div className="space-y-1">
                <DialogTitle>Revisar audio</DialogTitle>
                <DialogDescription>Escuchalo antes de confirmar. Solo al confirmar se crea la transcripcion.</DialogDescription>
              </div>
              <DialogClose asChild>
                <button
                  type="button"
                  className="flex h-14 w-14 items-center justify-center rounded-full border-2 border-black text-black transition-colors hover:bg-black hover:text-white"
                  aria-label="Cerrar modal"
                >
                  <X className="h-7 w-7" />
                </button>
              </DialogClose>
            </div>
          </DialogHeader>

          {reviewAudio ? (
            <div className="space-y-3">
              <audio controls src={reviewAudio.url} className="w-full" />
              <p className="text-sm text-slate-500">
                {recordingTarget?.subjectName || getSubjectDisplayName(currentSubject)} - {recordingTarget ? getWeekdayLabel(recordingTarget.sessionDate) : getWeekdayLabel(currentDateKey)} - {recordingTarget?.sessionDate || currentDateKey}
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
        <DialogContent showCloseButton={false} className="sm:max-w-md">
          <DialogHeader>
            <div className="flex items-start justify-between gap-4">
              <div className="space-y-1">
                <DialogTitle>Agregar link</DialogTitle>
                <DialogDescription>Este link queda guardado en la duda seleccionada.</DialogDescription>
              </div>
              <DialogClose asChild>
                <button
                  type="button"
                  className="flex h-14 w-14 items-center justify-center rounded-full border-2 border-black text-black transition-colors hover:bg-black hover:text-white"
                  aria-label="Cerrar modal"
                >
                  <X className="h-7 w-7" />
                </button>
              </DialogClose>
            </div>
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

      <Dialog open={isReviewOpen} onOpenChange={setIsReviewOpen}>
        <DialogContent
          showCloseButton={false}
          className="flex h-[100dvh] w-screen max-w-none flex-col overflow-hidden rounded-none border-0 p-0 sm:max-w-none"
        >
          <DialogHeader className="border-b border-slate-200 bg-white px-6 py-5 sm:px-8">
            <div className="flex items-start justify-between gap-4">
              <div className="space-y-1">
                <DialogTitle>Repaso</DialogTitle>
                <DialogDescription>Selecciona una materia y entra directo a los dias con audio destacado.</DialogDescription>
              </div>
              <DialogClose asChild>
                <button
                  type="button"
                  className="flex h-14 w-14 items-center justify-center rounded-full border-2 border-black text-black transition-colors hover:bg-black hover:text-white"
                  aria-label="Cerrar modal"
                >
                  <X className="h-7 w-7" />
                </button>
              </DialogClose>
            </div>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto bg-slate-50/60 px-6 py-6 sm:px-8">
            {reviewSubjectId === "" ? (
              <div className="mx-auto flex h-full w-full max-w-4xl flex-col justify-center gap-8">
                <div className="space-y-2">
                  <p className="text-sm font-medium uppercase tracking-[0.24em] text-slate-400">Acceso rapido</p>
                  <h2 className="text-3xl font-semibold text-slate-800 sm:text-4xl">Elegi una materia</h2>
                </div>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {visibleSubjects.map((subject) => (
                    <button
                      key={subject.id}
                      type="button"
                      onClick={() => void loadReviewEntries(subject.id)}
                      className="rounded-3xl border border-slate-200 bg-white px-5 py-6 text-left shadow-sm transition hover:border-slate-300 hover:bg-slate-50"
                    >
                      <p className="text-base font-semibold text-slate-800">{subject.name.replace("\n", " ")}</p>
                    </button>
                  ))}
                </div>
              </div>
            ) : isLoadingReview ? (
              <div className="flex h-full items-center justify-center py-10">
                <Loader2 className="h-8 w-8 animate-spin text-slate-400" />
              </div>
            ) : (
              <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <p className="text-sm text-slate-500">Materia</p>
                    <h2 className="text-2xl font-semibold text-slate-800">
                      {getSubjectDisplayName(getSubjectById(reviewSubjectId, visibleSubjects))}
                    </h2>
                  </div>
                  <Button
                    variant="outline"
                    onClick={() => {
                      setReviewSubjectId("")
                      setReviewEntries([])
                      setReviewError("")
                    }}
                  >
                    Otra materia
                  </Button>
                </div>

                {reviewError ? <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{reviewError}</div> : null}

                {Object.keys(reviewEntriesByWeek).length === 0 ? (
                  <div className="rounded-3xl border border-slate-200 bg-white px-6 py-10 text-center shadow-sm">
                    <p className="text-sm text-slate-500">No hay audios destacados para esta materia.</p>
                  </div>
                ) : (
                  Object.entries(reviewEntriesByWeek)
                    .sort(([leftWeek], [rightWeek]) => Number(leftWeek) - Number(rightWeek))
                    .map(([weekNumber, weekEntries]) => (
                      <section key={weekNumber} className="space-y-3">
                        <h3 className="text-lg font-semibold text-slate-800">Semana {weekNumber}</h3>
                        <div className="space-y-3">
                          {weekEntries.map((entry) => (
                            <article key={entry.id} className="rounded-3xl border border-slate-200 bg-white px-4 py-4 shadow-sm">
                              <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                                <div className="min-w-0">
                                  <p className="text-sm font-medium text-slate-500">{getWeekdayLabel(entry.session_date)}</p>
                                  <p className="truncate text-lg font-semibold text-slate-800">{getEntryDisplayTitle(entry)}</p>
                                </div>
                                <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                                  <audio controls preload="none" src={`/api/subject-day-entries/${entry.id}/audio`} className="sm:w-[320px]" />
                                  <Button
                                    type="button"
                                    variant="outline"
                                    onClick={() => void openSubjectDay(entry.subject_id, entry.session_date)}
                                    className="border-black text-black"
                                  >
                                    Ver Dia
                                  </Button>
                                </div>
                              </div>
                            </article>
                          ))}
                        </div>
                      </section>
                    ))
                )}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Practice Modal */}
      <Dialog open={isPracticeOpen} onOpenChange={setIsPracticeOpen}>
        <DialogContent showCloseButton={false} className="flex h-[100dvh] w-screen max-w-none flex-col overflow-hidden rounded-none border-0 p-0 sm:max-w-none">
          <DialogHeader className="border-b border-slate-200 bg-gradient-to-r from-slate-50 via-white to-sky-50 px-6 py-5 sm:px-8">
            <div className="flex items-start justify-between gap-4">
              <div className="flex min-w-0 items-center gap-4">
                <DialogTitle className="flex items-center gap-2">
                  <GraduationCap className="h-5 w-5 text-slate-600" />
                  Practicar
                </DialogTitle>
                <div className="flex items-center gap-2 text-sm text-slate-500">
                  <Switch
                    checked={showAllSubjectsForDay}
                    onCheckedChange={handleShowAllSubjectsChange}
                    aria-label="Mostrar todas las materias del dia"
                    className="h-5 w-9 data-[state=checked]:bg-slate-900 data-[state=unchecked]:bg-slate-300"
                  />
                </div>
              </div>
              <div className="flex items-center gap-2">
                {authSession.isAdmin ? (
                  <Button
                    onClick={() => setIsAdminModalOpen(true)}
                    variant="outline"
                    className="h-10 border-slate-900 bg-[linear-gradient(135deg,rgba(15,23,42,0.95),rgba(51,65,85,0.92))] px-4 text-white shadow-[0_10px_30px_rgba(15,23,42,0.16)] hover:bg-slate-800 hover:text-white"
                  >
                    Administrar
                  </Button>
                ) : null}
                <DialogClose asChild>
                  <button
                    type="button"
                    className="flex h-14 w-14 items-center justify-center rounded-full border-2 border-black text-black transition-colors hover:bg-black hover:text-white"
                    aria-label="Cerrar modal"
                  >
                    <X className="h-7 w-7" />
                  </button>
                </DialogClose>
              </div>
            </div>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto bg-slate-50/60 px-6 py-6 sm:px-8">
            {/* Subject selection */}
            {practiceLaunchView === "theory" && practiceSubjectIndex === null && (
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
                        {visibleSubjects.map((s) => (
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
                  <div className="flex gap-2">
                    <Button variant="outline" onClick={() => setIsPracticeOpen(false)} className="h-12 px-6">
                      Volver
                    </Button>
                    <Button
                      onClick={() => practiceSubjectId && practiceWeekNumber && void loadPracticeEntries(practiceSubjectId, practiceWeekNumber, practiceFilters)}
                      disabled={!practiceSubjectId || !practiceWeekNumber}
                      className="h-12 px-6"
                    >
                      Cargar dudas
                    </Button>
                  </div>
                </div>
              </div>
            )}

            {practiceLaunchView === "exercises" && (
              <div className="mx-auto flex h-full w-full max-w-5xl flex-col justify-center gap-8">
                <div className="space-y-2">
                  <h2 className="text-3xl font-semibold text-slate-800 sm:text-4xl">Materias del dia</h2>
                </div>

                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {practiceDaySubjects.map((subject) => (
                    <button
                      key={subject.id}
                      type="button"
                      onClick={() => void openExercisesPracticeSubject(subject.id)}
                      className="rounded-3xl border border-slate-200 bg-white p-5 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-slate-300"
                    >
                      <p className="text-lg font-semibold text-slate-800">{subject.name.replace("\n", " ")}</p>
                    </button>
                  ))}
                </div>

                <div className="flex justify-end">
                  <Button variant="outline" onClick={() => setIsPracticeOpen(false)} className="h-12 px-6">
                    Volver
                  </Button>
                </div>
              </div>
            )}

            {/* Loading state */}
            {practiceLaunchView === "theory" && practiceSubjectIndex !== null && isLoadingPractice && (
              <div className="flex h-full items-center justify-center py-10">
                <Loader2 className="h-8 w-8 animate-spin text-slate-400" />
              </div>
            )}

            {/* No questions */}
            {practiceLaunchView === "theory" && practiceSubjectIndex !== null && !isLoadingPractice && practiceVisibleEntries.length === 0 && (
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
            {practiceLaunchView === "theory" && practiceSubjectIndex !== null && !isLoadingPractice && practiceVisibleEntries.length > 0 && (
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
