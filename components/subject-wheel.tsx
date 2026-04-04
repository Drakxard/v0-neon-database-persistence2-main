"use client"

import { useState, useMemo, useEffect, useRef, useCallback } from "react"
import { BarChart3, ChevronLeft, ChevronRight, RotateCcw, Check, Copy, ExternalLink, FilePenLine, Loader2, Palette, Plus, Sparkles, GraduationCap, Pencil, X, Link2, Mic, Pause, Play, Square } from "lucide-react"
import { useTheme } from "next-themes"
import { AdminAccessModal } from "@/components/admin-access-modal"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { useDailySessionState } from "@/hooks/use-daily-session-state"
import { useMaterialUploads } from "@/hooks/use-material-uploads"
import { useMobileReviewOverview } from "@/hooks/use-mobile-review-overview"
import { useSubjectEntries } from "@/hooks/use-subject-entries"
import { toast } from "@/hooks/use-toast"
import type { AuthSession } from "@/lib/authz"
import { getErrorMessage, parseJsonResponse, requireOkJson } from "@/lib/client/api"
import { saveDailySession } from "@/lib/daily-study-client"
import { createPracticeAudioEntry, createPracticeTextEntry } from "@/lib/practice-entry-client"
import { fetchSubjectSynthesisMaterials, saveSubjectSynthesisMaterials } from "@/lib/subject-synthesis-materials-client"
import { getEmptySubjectShortcuts } from "@/lib/subject-shortcuts-client"
import { APP_THEMES, isAppTheme } from "@/lib/theme-options"
import type {
  PendingSubjectDayMaterial,
  PracticeCoverageStatus,
  SubjectDayEntry,
  SubjectDayEntryLink,
  SubjectDayMaterial,
  SubjectMaterialSynthesisRecord,
  SubjectDayMaterialType,
  SubjectShortcutKey,
  SubjectShortcuts,
  SubjectSynthesisDerivedSummary,
  SubjectSynthesisRecord,
  SubjectSynthesisSubjectPayload,
  VectorOverview,
} from "@/lib/study-types"
import { SUBJECTS, SUBJECT_ID_TO_INDEX } from "@/lib/subjects"
import { formatDateKey, getCurrentWeekNumber, getWeekDates, getWeekNumberForDate, getWeekdayLabel, parseDateKey } from "@/lib/subject-utils"

interface Subject {
  id: string
  name: string
  color: string
}

const NIGHT_SUBJECT_COLORS: Record<string, string> = {
  algebra: "#366476",
  calculo2: "#3f5f94",
  calculo3: "#8b6138",
  fisica: "#8f434a",
  logica: "#3c6953",
  probabilidad: "#69598b",
}

const SYNTHESIS_SUBJECT_IDS = ["calculo3", "fisica", "logica", "probabilidad"] as const

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

type AnalysisSubjectCard = {
  subjectId: string
  subjectName: string
  hasVector: boolean
  currentDay: number | null
  severity: "green" | "yellow" | "red" | "neutral"
  stateLabel: string
  coveredCount: number
  relevantCount: number
  totalCount: number
  lastInteractionAt: string | null
  staleReason: string[]
}

type SynthesisPlaybackItem = {
  materialId: number
  entryId: number
}

type PendingSynthesisSave = {
  subjectId: string
  weekNumber: number
}

type SynthesisMaterialDraft = {
  exerciseScopeText: string
  exerciseSolvedCount: string
  exerciseTotalCount: string
}

type SynthesisSubjectState = {
  materials: SubjectDayMaterial[]
  entries: SubjectDayEntry[]
  legacySummary: SubjectSynthesisRecord
  perMaterialProgress: Record<number, SubjectMaterialSynthesisRecord>
  drafts: Record<number, SynthesisMaterialDraft>
  isLoading: boolean
  isSaving: boolean
  error: string
}

function buildMaterialDraftViewerHref(params: {
  subjectId: string
  subjectName: string
  sessionDate: string
  weekNumber: number
  weekdayIndex: number
  materialType: SubjectDayMaterialType
}) {
  const searchParams = new URLSearchParams({
    subjectId: params.subjectId,
    subjectName: params.subjectName,
    sessionDate: params.sessionDate,
    weekNumber: String(params.weekNumber),
    weekdayIndex: String(params.weekdayIndex),
    materialType: params.materialType,
  })

  return `/practice/viewer?${searchParams.toString()}`
}

function buildPracticeDraftViewerHref(params: {
  subjectId: string
  subjectName: string
  sessionDate: string
  weekNumber: number
  weekdayIndex: number
}) {
  return buildMaterialDraftViewerHref({
    ...params,
    materialType: "practice",
  })
}

function buildMaterialViewerHref(materialId: number) {
  const searchParams = new URLSearchParams({
    materialId: String(materialId),
  })

  return `/practice/viewer?${searchParams.toString()}`
}

interface ReviewAudio {
  blob: Blob
  url: string
  mimeType: string
}

type PairRole = "question" | "answer"

type AudioPairSlot = {
  url: string
  mimeType: string
  blob: Blob | null
  source: "local" | "persisted"
  entryId: number | null
  originalRole: PairRole | null
}

type AudioPairDraft = {
  target: AudioUploadTarget
  pairId: string
  slots: Record<PairRole, AudioPairSlot | null>
}

type AudioUploadTarget = {
  source: "subject-dialog" | "continue-practice" | "continue-context"
  subjectId: string
  subjectName: string
  sessionDate: string
  weekNumber: number
  weekdayIndex: number
  materialId?: number | null
}

function generatePairId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID()
  }

  return `pair-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

function formatLastInteractionLabel(value: string | null) {
  if (!value) return "Nunca"
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return "Sin dato"
  return new Intl.DateTimeFormat("es-AR", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date)
}

function getCoverageReasonLabel(reason: string) {
  switch (reason) {
    case "sin_dupla_en_pdf_relevante":
      return "practica pendiente"
    case "sin_interaccion_movil_reciente":
      return "sin repaso movil"
    case "fragil":
      return "fragil"
    default:
      return reason.replaceAll("_", " ")
  }
}

function getVectorDayLabel(currentDay: number | null, hasVector: boolean) {
  if (!hasVector || currentDay == null) return "Sin teoria"
  if (currentDay === 0) return "Inicio"
  return `Dia ${currentDay}`
}

function getVectorDayTone(currentDay: number | null, hasVector: boolean) {
  if (!hasVector || currentDay == null) {
    return "border-border bg-muted/30 text-muted-foreground"
  }
  if (currentDay >= 5) {
    return "border-red-300 bg-red-50 text-red-700"
  }
  if (currentDay >= 3) {
    return "border-amber-300 bg-amber-50 text-amber-700"
  }
  return "border-emerald-300 bg-emerald-50 text-emerald-700"
}

function getCurrentSubjectVectorBadgeLabel(summary: {
  currentDay: number | null
  hasVector: boolean
  hasTheory: boolean
}) {
  if (summary.hasVector) return getVectorDayLabel(summary.currentDay, true)
  if (summary.hasTheory) return "Teoria cargada"
  return "Sin teoria"
}

type ManualEntryTarget = {
  subjectId: string
  sessionDate: string
  weekNumber: number
  weekdayIndex: number
  materialId?: number | null
}

type PendingFeaturedUpdate = {
  entryId: number
  isFeatured: boolean
  featuredScope?: "entry_scope" | "subject_week"
}

type ContinueMode = "practice" | "theory"

type SubjectDialogEntryMode = "default" | "theory_continue"

type ContinuePayload = {
  mode: ContinueMode
  material: SubjectDayMaterial | null
  previousFeaturedEntry: SubjectDayEntry | null
}

type ContinuePairGroup = {
  kind: "pair"
  pairId: string
  titleEntry: SubjectDayEntry
  questionEntry: SubjectDayEntry
  answerEntry: SubjectDayEntry
}

type ContinueSingleGroup = {
  kind: "single"
  entry: SubjectDayEntry
}

type ContinueGroup = ContinuePairGroup | ContinueSingleGroup

type SubjectVisibilityState = {
  activeSubjects: Subject[]
  completedSubjects: Subject[]
}

type SubjectHistoryState = SubjectVisibilityState & {
  allCompletedIds: string[]
}

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

function getSynthesisSubjects(subjects: Subject[]) {
  return SYNTHESIS_SUBJECT_IDS.map((subjectId) => getSubjectById(subjectId, subjects)).filter(Boolean) as Subject[]
}

function normalizeWeekdayLabel(label: string) {
  return label.trim().toLowerCase()
}

function getSynthesisCountdownLabel(params: {
  subjectId: string
  fromDate: Date
}) {
  const { subjectId, fromDate } = params

  for (let offset = 0; offset < 7; offset += 1) {
    const candidate = new Date(fromDate)
    candidate.setDate(fromDate.getDate() + offset)
    if (getScheduledSubjectIdsForDate(candidate).includes(subjectId)) {
      return {
        daysUntil: offset,
        weekdayLabel: normalizeWeekdayLabel(getWeekdayLabel(formatDateKey(candidate))),
      }
    }
  }

  return null
}

function getSynthesisHeaderLabel(params: {
  subject: Subject | null
  percentage: number
  weekNumber: number
  currentWeekNumber: number
  referenceDate: Date
}) {
  const { subject, percentage, weekNumber, currentWeekNumber, referenceDate } = params
  const subjectName = getSubjectDisplayName(subject)
  if (!subjectName || !subject) return ""
  const prefix = `${percentage}% ${subjectName}`
  if (weekNumber !== currentWeekNumber) return prefix

  const countdown = getSynthesisCountdownLabel({
    subjectId: subject.id,
    fromDate: referenceDate,
  })

  if (!countdown) return prefix
  const dayLabel = countdown.daysUntil === 1 ? "dia" : "dias"
  return `${prefix}, falta ${countdown.daysUntil} ${dayLabel} para el ${countdown.weekdayLabel}`
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

function mergeSubjectDayMaterials(...materialGroups: SubjectDayMaterial[][]) {
  const materialMap = new Map<string, SubjectDayMaterial>()

  for (const group of materialGroups) {
    for (const material of group) {
      materialMap.set(String(material.id), material)
    }
  }

  return sortSubjectDayMaterials(Array.from(materialMap.values()))
}

function getShortcutUrl(shortcuts: SubjectShortcuts, shortcutKey: SubjectShortcutKey) {
  return shortcutKey === "e_fich" ? shortcuts.eFich : shortcuts.figma
}

function isPdfFile(file: File) {
  return file.type === "application/pdf" || file.name.trim().toLowerCase().endsWith(".pdf")
}

function getEntryDisplayTitle(entry: Pick<SubjectDayEntry, "display_title" | "custom_title" | "order_index">) {
  const customTitle = entry.custom_title?.trim()
  if (customTitle) return customTitle
  const displayTitle = entry.display_title?.trim()
  if (displayTitle) return displayTitle
  return `Duda ${entry.order_index + 1}`
}

function buildContinueGroups(entries: SubjectDayEntry[]) {
  const chronologicalEntries = sortSubjectDayEntriesChronologically(entries)
  const groups: ContinueGroup[] = []
  const consumedIds = new Set<number>()
  const pairBuckets = new Map<string, SubjectDayEntry[]>()

  for (const entry of chronologicalEntries) {
    if (entry.pair_id) {
      const bucket = pairBuckets.get(entry.pair_id) ?? []
      bucket.push(entry)
      pairBuckets.set(entry.pair_id, bucket)
    }
  }

  for (const entry of chronologicalEntries) {
    if (consumedIds.has(entry.id)) continue

    if (!entry.pair_id) {
      groups.push({ kind: "single", entry })
      consumedIds.add(entry.id)
      continue
    }

    const bucket = pairBuckets.get(entry.pair_id) ?? []
    const questionEntry = bucket.find((item) => item.pair_role === "question") ?? null
    const answerEntry = bucket.find((item) => item.pair_role === "answer") ?? null

    if (!questionEntry || !answerEntry) {
      groups.push({ kind: "single", entry })
      consumedIds.add(entry.id)
      continue
    }

    if (consumedIds.has(questionEntry.id) || consumedIds.has(answerEntry.id)) {
      continue
    }

    groups.push({
      kind: "pair",
      pairId: entry.pair_id,
      titleEntry: questionEntry,
      questionEntry,
      answerEntry,
    })
    consumedIds.add(questionEntry.id)
    consumedIds.add(answerEntry.id)
  }

  return groups
}

function buildSynthesisPlaybackQueue(
  materials: SubjectDayMaterial[],
  entriesByMaterialId: Record<number, SubjectDayEntry[]>
) {
  return materials.flatMap((material) => {
    const groups = buildContinueGroups(entriesByMaterialId[material.id] ?? [])

    return groups.flatMap((group) => {
      if (group.kind === "pair") {
        return [group.questionEntry, group.answerEntry]
          .filter((entry) => entryHasAudio(entry))
          .map((entry) => ({
            materialId: material.id,
            entryId: entry.id,
          }))
      }

      return entryHasAudio(group.entry)
        ? [
            {
              materialId: material.id,
              entryId: group.entry.id,
            },
          ]
        : []
    })
  })
}

function entryHasAudio(entry: Pick<SubjectDayEntry, "drive_file_id" | "drive_mime_type">) {
  return entry.drive_file_id.trim().length > 0 && entry.drive_mime_type.startsWith("audio/")
}

function entryHasTranscript(entry: Pick<SubjectDayEntry, "transcript_text">) {
  return entry.transcript_text.trim().length > 0
}

function shouldRenderInTheoryView(
  entry: Pick<SubjectDayEntry, "subject_day_material_id" | "transcript_text" | "drive_file_id" | "drive_mime_type">
) {
  return entry.subject_day_material_id == null || (!entryHasTranscript(entry) && entryHasAudio(entry))
}

function isDailyEntryWithoutMaterial(entry: Pick<SubjectDayEntry, "subject_id" | "week_number" | "session_date" | "subject_day_material_id">, target: {
  subjectId: string
  weekNumber: number
  sessionDate: string
  materialId?: number | null
}) {
  return (
    entry.subject_id === target.subjectId &&
    entry.week_number === target.weekNumber &&
    entry.session_date === target.sessionDate &&
    entry.subject_day_material_id == null &&
    (target.materialId ?? null) == null
  )
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

function sortSubjectDayEntriesChronologically(entries: SubjectDayEntry[]) {
  return [...entries].sort((left, right) => {
    const leftCreatedAt = left.created_at?.trim() ?? ""
    const rightCreatedAt = right.created_at?.trim() ?? ""
    if (leftCreatedAt && rightCreatedAt && leftCreatedAt !== rightCreatedAt) {
      return leftCreatedAt.localeCompare(rightCreatedAt)
    }
    if (leftCreatedAt !== rightCreatedAt) {
      return leftCreatedAt ? -1 : 1
    }

    return left.id - right.id
  })
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

function getNextUncheckedMaterial(
  materials: SubjectDayMaterial[],
  {
    mode,
    subjectId,
    sessionDate,
    weekNumber,
  }: {
    mode: ContinueMode
    subjectId: string
    sessionDate: string
    weekNumber: number
  }
) {
  return sortSubjectDayMaterials(
    materials.filter(
      (material) =>
        material.material_type === mode &&
        material.subject_id === subjectId &&
        material.week_number === weekNumber &&
        (mode === "theory" || material.session_date === sessionDate) &&
        !material.is_checkup_done
    )
  )[0] ?? null
}

function resolveContinueMaterial(
  materials: SubjectDayMaterial[],
  materialId?: number
) {
  if (typeof materialId === "number") {
    return materials.find((material) => material.id === materialId) ?? null
  }

  return materials.find((material) => !material.is_checkup_done) ?? materials[0] ?? null
}

function buildMaterialCoverage(
  materials: SubjectDayMaterial[],
  entriesByMaterialId: Record<number, SubjectDayEntry[]>
) {
  return materials
    .filter((material): material is SubjectDayMaterial => !("is_pending_upload" in material))
    .map((material) => {
      const materialEntries = entriesByMaterialId[material.id] ?? []
      const pairCount = new Set(materialEntries.map((entry) => entry.pair_id).filter(Boolean)).size
      const status: PracticeCoverageStatus =
        pairCount > 0 ? "cubierto_minimo" : materialEntries.length > 0 ? "tocado_sin_dupla" : "sin_tocar"

      return {
        id: material.id,
        fileName: material.file_name,
        sessionDate: material.session_date,
        status,
        isCheckupDone: material.is_checkup_done,
        pairCount,
        entryCount: materialEntries.length,
      }
    })
}

function getDefaultSubjectSynthesisRecord(subjectId: string, weekNumber: number): SubjectSynthesisRecord {
  return {
    subjectId,
    weekNumber,
    exerciseSolvedCount: 0,
    exerciseTotalCount: 0,
    exerciseSkippedText: "",
    updatedAt: null,
  }
}

function createEmptySynthesisMaterialDraft(): SynthesisMaterialDraft {
  return {
    exerciseScopeText: "",
    exerciseSolvedCount: "0",
    exerciseTotalCount: "0",
  }
}

function createSynthesisMaterialDraft(progress?: SubjectMaterialSynthesisRecord | null): SynthesisMaterialDraft {
  return {
    exerciseScopeText: progress?.exerciseScopeText ?? "",
    exerciseSolvedCount: String(progress?.exerciseSolvedCount ?? 0),
    exerciseTotalCount: String(progress?.exerciseTotalCount ?? 0),
  }
}

function getSynthesisDraftNumber(value: string) {
  return Math.max(0, Number.parseInt(value || "0", 10) || 0)
}

function hasSynthesisDraftValue(draft: SynthesisMaterialDraft | undefined) {
  if (!draft) return false

  return (
    draft.exerciseScopeText.trim().length > 0 ||
    getSynthesisDraftNumber(draft.exerciseSolvedCount) > 0 ||
    getSynthesisDraftNumber(draft.exerciseTotalCount) > 0
  )
}

function buildEmptySynthesisSubjectState(subjectId: string, weekNumber: number): SynthesisSubjectState {
  return {
    materials: [],
    entries: [],
    legacySummary: getDefaultSubjectSynthesisRecord(subjectId, weekNumber),
    perMaterialProgress: {},
    drafts: {},
    isLoading: false,
    isSaving: false,
    error: "",
  }
}

function buildSynthesisSubjectState(payload: SubjectSynthesisSubjectPayload): SynthesisSubjectState {
  const perMaterialProgress = payload.materialProgress.reduce<Record<number, SubjectMaterialSynthesisRecord>>((accumulator, progress) => {
    accumulator[progress.subjectDayMaterialId] = progress
    return accumulator
  }, {})
  const sortedMaterials = sortSubjectDayMaterials(payload.materials)
  const drafts = sortedMaterials.reduce<Record<number, SynthesisMaterialDraft>>((accumulator, material) => {
    accumulator[material.id] = createSynthesisMaterialDraft(perMaterialProgress[material.id] ?? null)
    return accumulator
  }, {})

  return {
    materials: sortedMaterials,
    entries: sortSubjectDayEntries(payload.entries),
    legacySummary: payload.legacySummary,
    perMaterialProgress,
    drafts,
    isLoading: false,
    isSaving: false,
    error: "",
  }
}

function buildSynthesisSubjectSummary(subjectId: string, weekNumber: number, state: SynthesisSubjectState | null | undefined): SubjectSynthesisDerivedSummary {
  const legacySummary = state?.legacySummary ?? getDefaultSubjectSynthesisRecord(subjectId, weekNumber)
  const practiceMaterials = (state?.materials ?? []).filter((material) => material.material_type === "practice")
  const draftItems = practiceMaterials.map((material) => state?.drafts[material.id] ?? createEmptySynthesisMaterialDraft())
  const hasPerMaterialProgress = draftItems.some((draft) => hasSynthesisDraftValue(draft))

  if (!hasPerMaterialProgress) {
    const legacyTotal = Math.max(0, legacySummary.exerciseTotalCount)
    const legacySolved = Math.max(0, legacySummary.exerciseSolvedCount)
    return {
      subjectId,
      weekNumber,
      hasPerMaterialProgress: false,
      exerciseSolvedCount: legacySolved,
      exerciseTotalCount: legacyTotal,
      percentage: legacyTotal > 0 ? Math.floor((legacySolved / legacyTotal) * 100) : 0,
      legacyExerciseSkippedText: legacySummary.exerciseSkippedText ?? "",
    }
  }

  const exerciseSolvedCount = draftItems.reduce((sum, draft) => sum + getSynthesisDraftNumber(draft.exerciseSolvedCount), 0)
  const exerciseTotalCount = draftItems.reduce((sum, draft) => sum + getSynthesisDraftNumber(draft.exerciseTotalCount), 0)

  return {
    subjectId,
    weekNumber,
    hasPerMaterialProgress: true,
    exerciseSolvedCount,
    exerciseTotalCount,
    percentage: exerciseTotalCount > 0 ? Math.floor((exerciseSolvedCount / exerciseTotalCount) * 100) : 0,
    legacyExerciseSkippedText: legacySummary.exerciseSkippedText ?? "",
  }
}

export function SubjectWheel({ authSession }: { authSession: AuthSession }) {
  const visibleSubjects = useMemo<Subject[]>(
    () => SUBJECTS.filter((subject) => authSession.isAdmin || authSession.allowedSubjectIds.includes(subject.id)),
    [authSession.allowedSubjectIds, authSession.isAdmin]
  )
  const visibleSubjectIds = useMemo(() => visibleSubjects.map((subject) => subject.id), [visibleSubjects])
  const synthesisSubjects = useMemo(() => getSynthesisSubjects(visibleSubjects), [visibleSubjects])
  const [activeSubjects, setActiveSubjects] = useState<Subject[]>(() => getDisplaySubjectsForDate(parseDateKey(getTodayDateString()), false, visibleSubjects))
  const [completedSubjects, setCompletedSubjects] = useState<Subject[]>([])
  const [history, setHistory] = useState<SubjectHistoryState[]>([])
  const [historyIndex, setHistoryIndex] = useState(-1)
  const { theme, setTheme } = useTheme()
  const [themeMenuMounted, setThemeMenuMounted] = useState(false)

  useEffect(() => {
    setThemeMenuMounted(true)
  }, [])

  const [isDialogOpen, setIsDialogOpen] = useState(false)
  const [isNextWeekDialogOpen, setIsNextWeekDialogOpen] = useState(false)
  const [currentSubject, setCurrentSubject] = useState<Subject | null>(null)
  const [subjectDialogEntryMode, setSubjectDialogEntryMode] = useState<SubjectDialogEntryMode>("default")
  const [currentDateKey, setCurrentDateKey] = useState(getTodayDateString())
  const [showAllSubjectsForDay, setShowAllSubjectsForDay] = useState(false)
  const [allCompletedSubjectIds, setAllCompletedSubjectIds] = useState<string[]>([])
  const [entries, setEntries] = useState<SubjectDayEntry[]>([])
  const [materials, setMaterials] = useState<SubjectDayMaterial[]>([])
  const [pendingMaterials, setPendingMaterials] = useState<PendingSubjectDayMaterial[]>([])
  const [isEntriesLoading, setIsEntriesLoading] = useState(false)
  const [isMaterialsLoading, setIsMaterialsLoading] = useState(false)
  const [hasResolvedSubjectDayData, setHasResolvedSubjectDayData] = useState(false)
  const [entriesError, setEntriesError] = useState("")
  const [isRecording, setIsRecording] = useState(false)
  const [recordingError, setRecordingError] = useState("")
  const [reviewAudio, setReviewAudio] = useState<ReviewAudio | null>(null)
  const [recordingTarget, setRecordingTarget] = useState<AudioUploadTarget | null>(null)
  const [isReviewDialogOpen, setIsReviewDialogOpen] = useState(false)
  const [audioPairDraft, setAudioPairDraft] = useState<AudioPairDraft | null>(null)
  const [audioPairRecordingRole, setAudioPairRecordingRole] = useState<PairRole | null>(null)
  const [isUploadingAudio, setIsUploadingAudio] = useState(false)
  const [now, setNow] = useState(() => new Date())
  const [editingAnswerId, setEditingAnswerId] = useState<number | null>(null)
  const [manualEntryTarget, setManualEntryTarget] = useState<ManualEntryTarget | null>(null)
  const [manualQuestionDraft, setManualQuestionDraft] = useState("")
  const [manualAnswerDraft, setManualAnswerDraft] = useState("")
  const [answerDrafts, setAnswerDrafts] = useState<Record<number, string>>({})
  const [questionDrafts, setQuestionDrafts] = useState<Record<number, string>>({})
  const [editingTitleId, setEditingTitleId] = useState<number | null>(null)
  const [titleDrafts, setTitleDrafts] = useState<Record<number, string>>({})
  const [moveEntryTarget, setMoveEntryTarget] = useState<SubjectDayEntry | null>(null)
  const [moveEntryMaterialId, setMoveEntryMaterialId] = useState("")
  const [isMovingEntryId, setIsMovingEntryId] = useState<number | null>(null)
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
  const [dialogDateKey, setDialogDateKey] = useState(getTodayDateString())
  const [subjectViewDateOverride, setSubjectViewDateOverride] = useState<string | null>(null)
  const [dialogShowAllSubjectsForDay, setDialogShowAllSubjectsForDay] = useState(false)
  const [selectedPracticeMaterialId, setSelectedPracticeMaterialId] = useState<number | null>(null)
  const [isDeletingMaterialId, setIsDeletingMaterialId] = useState<number | null>(null)
  const [isLinkDialogOpen, setIsLinkDialogOpen] = useState(false)
  const [linkEntryId, setLinkEntryId] = useState<number | null>(null)
  const [linkDraft, setLinkDraft] = useState({ label: "", url: "" })
  const [isSavingLink, setIsSavingLink] = useState(false)
  const [isShortcutDialogOpen, setIsShortcutDialogOpen] = useState(false)
  const [shortcutDraft, setShortcutDraft] = useState("")
  const [shortcutDialogKey, setShortcutDialogKey] = useState<SubjectShortcutKey | null>(null)
  const [shortcutDialogMode, setShortcutDialogMode] = useState<"create" | "edit">("create")
  const [isSavingShortcut, setIsSavingShortcut] = useState(false)
  const [isContinueOpen, setIsContinueOpen] = useState(false)
  const [isContinueLoading, setIsContinueLoading] = useState(false)
  const [continueError, setContinueError] = useState("")
  const [continueMode, setContinueMode] = useState<ContinueMode>("practice")
  const [isAdminModalOpen, setIsAdminModalOpen] = useState(false)
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
  const [practiceVisibleEntries, setPracticeVisibleEntries] = useState<SubjectDayEntry[]>([])
  const [currentPracticeIndex, setCurrentPracticeIndex] = useState(0)
  const [isPracticeFinished, setIsPracticeFinished] = useState(false)
  const [isAnswerRevealed, setIsAnswerRevealed] = useState(false)
  const [isExampleModalOpen, setIsExampleModalOpen] = useState(false)
  const [exampleLinkDraft, setExampleLinkDraft] = useState("")
  const [exampleImageFile, setExampleImageFile] = useState<File | null>(null)
  const currentAppTheme = themeMenuMounted && isAppTheme(theme) ? theme : "daylight"
  const getSubjectVisualColor = useCallback(
    (subject: Subject) => (currentAppTheme === "night" ? NIGHT_SUBJECT_COLORS[subject.id] ?? subject.color : subject.color),
    [currentAppTheme]
  )
  const wheelStrokeColor = currentAppTheme === "night" ? "#d8dfeb" : "white"
  const wheelTextColor = currentAppTheme === "night" ? "#f2f5fb" : "white"
  const [exampleError, setExampleError] = useState("")
  const [stackedDayViewReturnState, setStackedDayViewReturnState] = useState<{
    dialogDateKey: string
    practiceSectionView: "theory" | "exercises"
    exerciseWeeklyScopeEnabled: boolean
    subjectViewDateOverride: string | null
    dialogShowAllSubjectsForDay: boolean
    selectedPracticeMaterialId: number | null
  } | null>(null)
  const [isReviewOpen, setIsReviewOpen] = useState(false)
  const [reviewSubjectId, setReviewSubjectId] = useState("")
  const [isSynthesisOpen, setIsSynthesisOpen] = useState(false)
  const [isSynthesisWeekSelectorOpen, setIsSynthesisWeekSelectorOpen] = useState(false)
  const [synthesisSubjectId, setSynthesisSubjectId] = useState<string>("")
  const [synthesisWeekNumber, setSynthesisWeekNumber] = useState(0)
  const [synthesisSubjectStateMap, setSynthesisSubjectStateMap] = useState<Record<string, SynthesisSubjectState>>({})
  const [synthesisPlaybackQueue, setSynthesisPlaybackQueue] = useState<SynthesisPlaybackItem[]>([])
  const [synthesisPlaybackIndex, setSynthesisPlaybackIndex] = useState(-1)
  const [isSynthesisPlaybackActive, setIsSynthesisPlaybackActive] = useState(false)
  const synthesisPlaybackAudioRef = useRef<HTMLAudioElement | null>(null)
  const synthesisLoadRequestIdRef = useRef(0)
  const synthesisSubjectStateMapRef = useRef<Record<string, SynthesisSubjectState>>({})
  const synthesisWeekNumberRef = useRef(0)
  const synthesisAutosaveTimersRef = useRef<Map<string, number>>(new Map())
  const practiceQuestions: Question[] = []
  const currentPracticeQuestionId = null
  const activeShortcutSubject = isDialogOpen && currentSubject
    ? currentSubject
    : isPracticeOpen && practiceLaunchView === "theory" && practiceSubjectId
      ? getSubjectById(practiceSubjectId, visibleSubjects)
      : null
  const activePracticeShortcutSubject =
    isPracticeOpen && practiceLaunchView === "theory" && practiceSubjectId
      ? getSubjectById(practiceSubjectId, visibleSubjects)
      : null

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
  const audioPairDraftRef = useRef<AudioPairDraft | null>(null)
  const recordingPairRoleRef = useRef<PairRole | null>(null)
  const audioCacheRef = useRef<Map<number, string>>(new Map())
  const audioElementRefs = useRef<Record<number, HTMLAudioElement | null>>({})
  const pendingMaterialCheckupTimersRef = useRef<Map<number, number>>(new Map())
  const pendingFeaturedUpdateRef = useRef<PendingFeaturedUpdate | null>(null)
  const pendingFeaturedSaveTimerRef = useRef<number | null>(null)
  const shortcutLongPressTimerRef = useRef<number | null>(null)
  const shouldSuppressShortcutClickRef = useRef(false)
  const subjectDayDataRequestIdRef = useRef(0)
  const todayKey = getTodayDateString()
  const currentCalendarWeek = useMemo(() => getCurrentWeekNumber(now), [now])
  const homeSelectedDate = useMemo(() => parseDateKey(currentDateKey), [currentDateKey])
  const homeSelectedWeekNumber = useMemo(() => getWeekNumberForDate(homeSelectedDate), [homeSelectedDate])
  const homeSelectedWeekNumberRef = useRef(homeSelectedWeekNumber)
  const synthesisSelectedSubject = useMemo(
    () => getSubjectById(synthesisSubjectId, synthesisSubjects),
    [synthesisSubjectId, synthesisSubjects]
  )
  const synthesisSubjectIndex = useMemo(
    () => synthesisSubjects.findIndex((subject) => subject.id === synthesisSubjectId),
    [synthesisSubjectId, synthesisSubjects]
  )
  const synthesisSelectedState = useMemo(() => {
    if (!synthesisSelectedSubject) return null
    return synthesisSubjectStateMap[synthesisSelectedSubject.id] ?? buildEmptySynthesisSubjectState(synthesisSelectedSubject.id, synthesisWeekNumber)
  }, [synthesisSelectedSubject, synthesisSubjectStateMap, synthesisWeekNumber])
  const synthesisSelectedSummary = useMemo(
    () =>
      synthesisSelectedSubject
        ? buildSynthesisSubjectSummary(synthesisSelectedSubject.id, synthesisWeekNumber, synthesisSelectedState)
        : null,
    [synthesisSelectedState, synthesisSelectedSubject, synthesisWeekNumber]
  )
  const dialogSelectedDate = useMemo(() => parseDateKey(dialogDateKey), [dialogDateKey])
  const dialogSelectedWeekNumber = useMemo(() => getWeekNumberForDate(dialogSelectedDate), [dialogSelectedDate])
  const dialogWeekDates = useMemo(() => getWeekDates(dialogSelectedWeekNumber), [dialogSelectedWeekNumber])
  const currentCalendarWeekRef = useRef(currentCalendarWeek)
  const previousCalendarWeekRef = useRef(currentCalendarWeek)
  const subjectDialogDateKey = subjectViewDateOverride ?? dialogDateKey
  const subjectDialogDayIndex = dialogWeekDates.findIndex((date) => formatDateKey(date) === subjectDialogDateKey)
  const lastVisibleDayIndex = dialogWeekDates.reduce((lastIndex, date, index) => {
    return formatDateKey(date) <= todayKey ? index : lastIndex
  }, -1)
  const isWeeklyExercisesScope = practiceSectionView === "exercises" && exerciseWeeklyScopeEnabled
  const handleDailySessionLoaded = useCallback(() => {
    setHistory([])
    setHistoryIndex(-1)
  }, [])
  const {
    reviewEntries,
    isLoadingReview,
    reviewError,
    practiceEntries,
    isLoadingPractice,
    practiceLoadError,
    subjectShortcuts,
    isSubjectShortcutsLoading,
    setReviewEntries,
    setReviewError,
    setPracticeLoadError,
    setPracticeEntries,
    setSubjectShortcuts,
    loadReviewEntries: loadSubjectReviewEntries,
    loadPracticeEntries: loadSubjectPracticeEntries,
    loadSubjectShortcuts: loadSubjectShortcutsData,
    saveSubjectShortcut: persistSubjectShortcut,
  } = useSubjectEntries()
  const { isUploadingMaterialType, uploadMaterials } = useMaterialUploads()
  const currentSubjectOverviewLoad = useMobileReviewOverview({
    enabled: Boolean(isDialogOpen && currentSubject),
    weekNumber: dialogSelectedWeekNumber,
    dateKey: subjectDialogDateKey,
    subjectId: currentSubject?.id ?? null,
    logPrefix: "current subject vector overview",
  })
  const { isLoading, saveStatus } = useDailySessionState({
    currentDateKey,
    homeSelectedDate,
    visibleSubjects,
    activeSubjects,
    allCompletedSubjectIds,
    showAllSubjectsForDay,
    setShowAllSubjectsForDay,
    setAllCompletedSubjectIds,
    setActiveSubjects,
    setCompletedSubjects,
    getDisplaySubjectsForDate,
    normalizeSubjectsForDay,
    onLoaded: handleDailySessionLoaded,
  })

  // Load the persisted session for the currently selected date.
  useEffect(() => {
    return () => {
      pendingMaterialCheckupTimersRef.current.forEach((timerId) => {
        window.clearTimeout(timerId)
      })
      pendingMaterialCheckupTimersRef.current.clear()
      synthesisAutosaveTimersRef.current.forEach((timerId) => {
        window.clearTimeout(timerId)
      })
      synthesisAutosaveTimersRef.current.clear()
      if (shortcutLongPressTimerRef.current !== null) {
        window.clearTimeout(shortcutLongPressTimerRef.current)
      }
    }
  }, [])

  useEffect(() => {
    homeSelectedWeekNumberRef.current = homeSelectedWeekNumber
  }, [homeSelectedWeekNumber])

  useEffect(() => {
    synthesisSubjectStateMapRef.current = synthesisSubjectStateMap
  }, [synthesisSubjectStateMap])

  useEffect(() => {
    synthesisWeekNumberRef.current = synthesisWeekNumber
  }, [synthesisWeekNumber])


  useEffect(() => {
    currentCalendarWeekRef.current = currentCalendarWeek
  }, [currentCalendarWeek])

  useEffect(() => {
    const previousWeekNumber = previousCalendarWeekRef.current
    if (currentCalendarWeek > previousWeekNumber && homeSelectedWeekNumber < currentCalendarWeek) {
      setCurrentDateKey(todayKey)
    }
    previousCalendarWeekRef.current = currentCalendarWeek
  }, [currentCalendarWeek, homeSelectedWeekNumber, todayKey])


  useEffect(() => {
    const intervalId = window.setInterval(() => {
      setNow(new Date())
    }, 1000)

    return () => window.clearInterval(intervalId)
  }, [])

  useEffect(() => {
    if (!isSynthesisOpen || synthesisSubjects.length === 0) return

    const requestId = synthesisLoadRequestIdRef.current + 1
    synthesisLoadRequestIdRef.current = requestId
    setSynthesisSubjectStateMap(
      Object.fromEntries(
        synthesisSubjects.map((subject) => [
          subject.id,
          {
            ...buildEmptySynthesisSubjectState(subject.id, synthesisWeekNumber),
            isLoading: true,
          },
        ])
      )
    )

    void Promise.allSettled(
      synthesisSubjects.map(async (subject) => ({
        subjectId: subject.id,
        payload: await fetchSubjectSynthesisMaterials(subject.id, synthesisWeekNumber),
      }))
    ).then((results) => {
      if (requestId !== synthesisLoadRequestIdRef.current) return

      setSynthesisSubjectStateMap((previous) => {
        const nextState = { ...previous }

        results.forEach((result, index) => {
          if (result.status === "fulfilled") {
            nextState[result.value.subjectId] = buildSynthesisSubjectState(result.value.payload)
            return
          }

          const subjectId = synthesisSubjects[index]?.id
          if (!subjectId) return
          nextState[subjectId] = {
            ...buildEmptySynthesisSubjectState(subjectId, synthesisWeekNumber),
            error: result.reason instanceof Error ? result.reason.message : "No se pudo cargar la sintesis semanal.",
          }
        })

        return nextState
      })
    })
  }, [isSynthesisOpen, synthesisSubjects, synthesisWeekNumber])

  useEffect(() => {
    if (!isSynthesisOpen) {
      const audio = synthesisPlaybackAudioRef.current
      audio?.pause()
      setSynthesisPlaybackQueue([])
      setSynthesisPlaybackIndex(-1)
      setIsSynthesisPlaybackActive(false)
    }
  }, [isSynthesisOpen])

  useEffect(() => {
    const audio = synthesisPlaybackAudioRef.current
    const nextPlaybackItem =
      synthesisPlaybackIndex >= 0 && synthesisPlaybackIndex < synthesisPlaybackQueue.length
        ? synthesisPlaybackQueue[synthesisPlaybackIndex]
        : null

    if (!audio) return

    if (!isSynthesisPlaybackActive || !nextPlaybackItem) {
      audio.pause()
      return
    }

    const nextSrc = `/api/subject-day-entries/${nextPlaybackItem.entryId}/audio`
    if (audio.src !== new URL(nextSrc, window.location.origin).toString()) {
      audio.src = nextSrc
      audio.load()
    }

    void audio.play().catch((error) => {
      console.error("Failed to play synthesis queue audio:", error)
      setIsSynthesisPlaybackActive(false)
    })
  }, [isSynthesisPlaybackActive, synthesisPlaybackIndex, synthesisPlaybackQueue])

  useEffect(() => {
    const currentQuestion = practiceQuestions[currentPracticeIndex]
    setIsExampleModalOpen(false)
    setExampleImageFile(null)
    setExampleError("")
    setExampleLinkDraft(currentQuestion?.example_link || "")
  }, [practiceSubjectIndex, currentPracticeIndex, currentPracticeQuestionId])


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
        if (homeSelectedWeekNumberRef.current < currentCalendarWeekRef.current + 1) {
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

    const requestId = subjectDayDataRequestIdRef.current + 1
    subjectDayDataRequestIdRef.current = requestId

    setIsEntriesLoading(true)
    setIsMaterialsLoading(true)
    setEntriesError("")

    try {
      const entriesParams = new URLSearchParams({
        subjectId: currentSubject.id,
        weekNumber: String(dialogSelectedWeekNumber),
      })

      if (!isWeeklyExercisesScope) {
        entriesParams.set("sessionDate", subjectDialogDateKey)
      }

      const materialRequestUrls =
        isWeeklyExercisesScope
          ? [
              `/api/subject-day-materials?${new URLSearchParams({
                subjectId: currentSubject.id,
                weekNumber: String(dialogSelectedWeekNumber),
                scope: "week",
                materialType: "theory",
              }).toString()}`,
              `/api/subject-day-materials?${new URLSearchParams({
                subjectId: currentSubject.id,
                weekNumber: String(dialogSelectedWeekNumber),
                scope: "week",
                materialType: "practice",
              }).toString()}`,
            ]
          : [`/api/subject-day-materials?${new URLSearchParams({
              subjectId: currentSubject.id,
              weekNumber: String(dialogSelectedWeekNumber),
              sessionDate: subjectDialogDateKey,
            }).toString()}`]

      const [entriesResult, ...materialResults] = await Promise.all([
        fetch(`/api/subject-day-entries?${entriesParams.toString()}`)
          .then(async (response) => {
            const payload = await parseJsonResponse(response)
            return {
              ok: response.ok,
              payload,
              error: response.ok ? "" : getErrorMessage(payload, "No se pudieron cargar las dudas del dia."),
            }
          })
          .catch((error) => ({
            ok: false,
            payload: null,
            error: error instanceof Error ? error.message : "No se pudieron cargar las dudas del dia.",
          })),
        ...materialRequestUrls.map((url) =>
          fetch(url)
            .then(async (response) => {
              const payload = await parseJsonResponse(response)
              return {
                ok: response.ok,
                payload,
                error: response.ok ? "" : getErrorMessage(payload, "No se pudieron cargar los materiales del dia."),
              }
            })
            .catch((error) => ({
              ok: false,
              payload: null,
              error: error instanceof Error ? error.message : "No se pudieron cargar los materiales del dia.",
            }))
        ),
      ])

      if (requestId !== subjectDayDataRequestIdRef.current) return

      const nextErrors: string[] = []

      if (entriesResult.ok) {
        setEntries(sortSubjectDayEntries(Array.isArray(entriesResult.payload) ? entriesResult.payload : []))
      } else if (entriesResult.error) {
        nextErrors.push(entriesResult.error)
      }

      const successfulMaterialGroups = materialResults
        .filter((result) => result.ok)
        .map((result) => (Array.isArray(result.payload) ? (result.payload as SubjectDayMaterial[]) : []))

      if (successfulMaterialGroups.length > 0 || materialResults.every((result) => result.ok)) {
        setMaterials(mergeSubjectDayMaterials(...successfulMaterialGroups))
      } else {
        const materialError = materialResults.find((result) => !result.ok)?.error
        if (materialError) {
          nextErrors.push(materialError)
        }
      }

      setEntriesError(nextErrors[0] ?? "")
      setHasResolvedSubjectDayData(true)
    } catch (error) {
      if (requestId !== subjectDayDataRequestIdRef.current) return

      console.error("Failed to load subject day data:", error)
      setEntriesError(error instanceof Error ? error.message : "No se pudieron cargar las dudas del dia.")
      setHasResolvedSubjectDayData(true)
    } finally {
      if (requestId !== subjectDayDataRequestIdRef.current) return

      setIsEntriesLoading(false)
      setIsMaterialsLoading(false)
    }
  }, [currentSubject, dialogSelectedWeekNumber, isDialogOpen, isWeeklyExercisesScope, practiceSectionView, subjectDialogDateKey])

  useEffect(() => {
    void loadSubjectDayData()
  }, [loadSubjectDayData])

  useEffect(() => {
    if (typeof window === "undefined") return

    const channel = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel("subject-day-materials") : null
    const handleRefreshPayload = (payload: unknown) => {
      if (!payload || typeof payload !== "object" || !currentSubject || !isDialogOpen) return
      if (!("subjectId" in payload) || !("sessionDate" in payload) || !("weekNumber" in payload)) return

      const subjectId = typeof payload.subjectId === "string" ? payload.subjectId : ""
      const sessionDate = typeof payload.sessionDate === "string" ? payload.sessionDate : ""
      const weekNumber = Number(payload.weekNumber)
      if (subjectId !== currentSubject.id || weekNumber !== dialogSelectedWeekNumber) return
      if (!isWeeklyExercisesScope && sessionDate !== subjectDialogDateKey) return

      void loadSubjectDayData()
    }

    const handleStorage = (event: StorageEvent) => {
      if (event.key !== "subject-day-materials:refresh" || !event.newValue) return
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
  }, [currentSubject, dialogSelectedWeekNumber, isDialogOpen, isWeeklyExercisesScope, loadSubjectDayData, subjectDialogDateKey])

  useEffect(() => {
    return () => {
      if (reviewAudio) {
        URL.revokeObjectURL(reviewAudio.url)
      }
      if (audioPairDraft) {
        Object.values(audioPairDraft.slots).forEach((audio) => {
          if (audio) URL.revokeObjectURL(audio.url)
        })
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
  }, [audioPairDraft, reviewAudio])

  useEffect(() => {
    audioPairDraftRef.current = audioPairDraft
  }, [audioPairDraft])

  const disposeReviewAudio = (nextAudio?: ReviewAudio | null) => {
    if (reviewAudio && reviewAudio !== nextAudio) {
      URL.revokeObjectURL(reviewAudio.url)
    }
  }

  const disposeAudioPairDraft = useCallback((draft?: AudioPairDraft | null) => {
    if (!draft) return
    Object.values(draft.slots).forEach((audio) => {
      if (audio?.source === "local") URL.revokeObjectURL(audio.url)
    })
  }, [])

  const clearPendingFeaturedSave = () => {
    if (pendingFeaturedSaveTimerRef.current) {
      window.clearTimeout(pendingFeaturedSaveTimerRef.current)
      pendingFeaturedSaveTimerRef.current = null
    }
  }

  const persistFeaturedEntry = useCallback(async (entryId: number, isFeatured: boolean, featuredScope: "entry_scope" | "subject_week" = "entry_scope") => {
    const response = await fetch(`/api/subject-day-entries/${entryId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isFeatured, featuredScope }),
    })

    const payload = await response.json()
    if (!response.ok) {
      throw new Error(getErrorMessage(payload, "No se pudo actualizar el destacado."))
    }

    return payload as SubjectDayEntry
  }, [])

  const applyFeaturedEntryLocally = useCallback((updatedEntry: SubjectDayEntry) => {
    setEntries((previousEntries) =>
      sortSubjectDayEntries(
        previousEntries.map((item) => {
          if (
            item.session_date === updatedEntry.session_date &&
            item.subject_id === updatedEntry.subject_id &&
            updatedEntry.is_featured
          ) {
            return { ...item, is_featured: false }
          }
          return item.id === updatedEntry.id ? updatedEntry : item
        })
      )
    )
  }, [])

  const applySubjectWeekFeaturedEntryLocally = useCallback((updatedEntry: SubjectDayEntry) => {
    setEntries((previousEntries) =>
      sortSubjectDayEntries(
        previousEntries.map((item) => {
          if (
            item.subject_id === updatedEntry.subject_id &&
            item.week_number === updatedEntry.week_number &&
            updatedEntry.is_featured
          ) {
            return { ...item, is_featured: item.id === updatedEntry.id }
          }
          return item.id === updatedEntry.id ? updatedEntry : item
        })
      )
    )
  }, [])

  const ensureDailyEntryFeatured = useCallback(
    async (
      createdEntry: SubjectDayEntry,
      options: {
        source: AudioUploadTarget["source"] | "manual-entry"
        target: Pick<AudioUploadTarget, "subjectId" | "weekNumber" | "sessionDate" | "materialId">
        existingEntries: SubjectDayEntry[]
      }
    ) => {
      if (options.source !== "subject-dialog" && options.source !== "manual-entry") {
        return createdEntry
      }

      if (!isDailyEntryWithoutMaterial(createdEntry, options.target)) {
        return createdEntry
      }

      const hasExistingFeatured = options.existingEntries.some(
        (entry) => entry.id !== createdEntry.id && isDailyEntryWithoutMaterial(entry, options.target) && entry.is_featured
      )
      if (hasExistingFeatured || createdEntry.is_featured) {
        return createdEntry
      }

      const updatedEntry = await persistFeaturedEntry(createdEntry.id, true)
      applyFeaturedEntryLocally(updatedEntry)
      return updatedEntry
    },
    [applyFeaturedEntryLocally, persistFeaturedEntry]
  )

  const flushPendingFeaturedUpdate = async () => {
    const pendingUpdate = pendingFeaturedUpdateRef.current
    if (!pendingUpdate) return

    clearPendingFeaturedSave()
    pendingFeaturedUpdateRef.current = null

    try {
      const updatedEntry = await persistFeaturedEntry(
        pendingUpdate.entryId,
        pendingUpdate.isFeatured,
        pendingUpdate.featuredScope ?? "entry_scope"
      )
      if (pendingUpdate.featuredScope === "subject_week") {
        applySubjectWeekFeaturedEntryLocally(updatedEntry)
      } else {
        applyFeaturedEntryLocally(updatedEntry)
      }
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
    recordingPairRoleRef.current = null
    setAudioPairRecordingRole(null)
    setIsRecording(false)
    setRecordingTarget(null)
  }

  const resetSubjectUiState = () => {
    subjectDayDataRequestIdRef.current += 1
    clearPendingFeaturedSave()
    pendingFeaturedUpdateRef.current = null
    if (shortcutLongPressTimerRef.current !== null) {
      window.clearTimeout(shortcutLongPressTimerRef.current)
      shortcutLongPressTimerRef.current = null
    }
    shouldSuppressShortcutClickRef.current = false
    audioCacheRef.current.forEach((url) => URL.revokeObjectURL(url))
    audioCacheRef.current.clear()
    audioElementRefs.current = {}
    setEntries([])
    setMaterials([])
    setPendingMaterials([])
    setHasResolvedSubjectDayData(false)
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
    setSubjectShortcuts(getEmptySubjectShortcuts())
    setIsShortcutDialogOpen(false)
    setShortcutDraft("")
    setShortcutDialogKey(null)
    setShortcutDialogMode("create")
    setIsSavingShortcut(false)
    setPracticeSectionView("theory")
    setExerciseWeeklyScopeEnabled(false)
    setSubjectDialogEntryMode("default")
    setSubjectViewDateOverride(null)
    setDialogShowAllSubjectsForDay(showAllSubjectsForDay)
    setSelectedPracticeMaterialId(null)
    setIsLinkDialogOpen(false)
    setLinkEntryId(null)
    setLinkDraft({ label: "", url: "" })
    setIsSavingLink(false)
    setIsContinueOpen(false)
    setIsContinueLoading(false)
    setContinueMode("practice")
    setContinueError("")
    setContinuePayload(null)
    setStackedDayViewReturnState(null)
  }

  const cancelReview = () => {
    disposeReviewAudio(null)
    setReviewAudio(null)
    setIsReviewDialogOpen(false)
    setRecordingTarget(null)
  }

  const cancelAudioPairReview = useCallback(() => {
    disposeAudioPairDraft(audioPairDraftRef.current)
    audioPairDraftRef.current = null
    recordingPairRoleRef.current = null
    setAudioPairDraft(null)
    setAudioPairRecordingRole(null)
    setRecordingTarget(null)
  }, [disposeAudioPairDraft])

  const closeSubjectDialog = async () => {
    await flushPendingFeaturedUpdate()
    stopAndDiscardRecording()

    Object.values(audioElementRefs.current).forEach((audioElement) => {
      audioElement?.pause()
    })
    setIsRecording(false)
    cancelReview()
    cancelAudioPairReview()
    setIsDialogOpen(false)
    setCurrentSubject(null)
    resetSubjectUiState()
  }

  const handleSubjectClick = (subject: Subject) => {
    setCurrentSubject(subject)
    setDialogDateKey(currentDateKey)
    resetSubjectUiState()
    setSubjectDialogEntryMode("theory_continue")
    setPracticeSectionView("exercises")
    setExerciseWeeklyScopeEnabled(true)
    setIsDialogOpen(true)
  }

  const openSubjectDay = async (subjectId: string, dateKey: string) => {
    await flushPendingFeaturedUpdate()
    const subject = getSubjectById(subjectId, visibleSubjects)
    if (!subject) return

    setCurrentSubject(subject)
    setDialogDateKey(dateKey)
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
    if (nextIndex < 0 || nextIndex >= dialogWeekDates.length || nextIndex > lastVisibleDayIndex) return
    const nextDateKey = formatDateKey(dialogWeekDates[nextIndex])
    if (subjectViewDateOverride) {
      setSubjectViewDateOverride(nextDateKey)
    } else {
      setDialogDateKey(nextDateKey)
    }
    setSelectedPracticeMaterialId(null)
  }

  const moveWeek = async (direction: -1 | 1) => {
    await flushPendingFeaturedUpdate()
    const nextDate = parseDateKey(dialogDateKey)
    nextDate.setDate(nextDate.getDate() + direction * 7)

    const nextWeekNumber = getWeekNumberForDate(nextDate)
    const latestWeekNumber = getCurrentWeekNumber()
    if (nextWeekNumber < 0 || nextWeekNumber > latestWeekNumber) return

    setDialogDateKey(formatDateKey(nextDate))
  }

  const openWeekAudioDay = async (dateKey: string) => {
    await flushPendingFeaturedUpdate()
    setStackedDayViewReturnState({
      dialogDateKey,
      practiceSectionView,
      exerciseWeeklyScopeEnabled,
      subjectViewDateOverride,
      dialogShowAllSubjectsForDay,
      selectedPracticeMaterialId,
    })
    setDialogDateKey(dateKey)
    setPracticeSectionView("theory")
    setExerciseWeeklyScopeEnabled(false)
    setSubjectViewDateOverride(null)
    setSelectedPracticeMaterialId(null)
  }

  const returnToCurrentDayView = async () => {
    await flushPendingFeaturedUpdate()
    setSubjectViewDateOverride(null)
    setSelectedPracticeMaterialId(null)
  }

  const closeSubjectDialogOrReturn = async () => {
    if (stackedDayViewReturnState) {
      await flushPendingFeaturedUpdate()
      setDialogDateKey(stackedDayViewReturnState.dialogDateKey)
      setPracticeSectionView(stackedDayViewReturnState.practiceSectionView)
      setExerciseWeeklyScopeEnabled(stackedDayViewReturnState.exerciseWeeklyScopeEnabled)
      setSubjectViewDateOverride(stackedDayViewReturnState.subjectViewDateOverride)
      setDialogShowAllSubjectsForDay(stackedDayViewReturnState.dialogShowAllSubjectsForDay)
      setSelectedPracticeMaterialId(stackedDayViewReturnState.selectedPracticeMaterialId)
      setStackedDayViewReturnState(null)
      return
    }

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

        if (target.source === "continue-practice") {
          const activeRole = recordingPairRoleRef.current
          if (audioPairDraftRef.current && activeRole) {
            setAudioPairDraft((previous) => {
              if (!previous) return previous
              const previousAudio = previous.slots[activeRole]
              const nextPairSlot: AudioPairSlot = {
                url: nextReviewAudio.url,
                mimeType: nextReviewAudio.mimeType,
                blob: nextReviewAudio.blob,
                source: "local",
                entryId: previousAudio?.entryId ?? null,
                originalRole: previousAudio?.originalRole ?? activeRole,
              }
              if (previousAudio?.source === "local") URL.revokeObjectURL(previousAudio.url)
              const nextDraft = {
                ...previous,
                slots: {
                  ...previous.slots,
                  [activeRole]: nextPairSlot,
                },
              }
              audioPairDraftRef.current = nextDraft
              return nextDraft
            })
          } else {
            const nextPairSlot: AudioPairSlot = {
              url: nextReviewAudio.url,
              mimeType: nextReviewAudio.mimeType,
              blob: nextReviewAudio.blob,
              source: "local",
              entryId: null,
              originalRole: activeRole ?? "question",
            }
            const nextDraft: AudioPairDraft = {
              target,
              pairId: generatePairId(),
              slots: {
                question: nextPairSlot,
                answer: null,
              },
            }
            audioPairDraftRef.current = nextDraft
            setAudioPairDraft(nextDraft)
          }
          setAudioPairRecordingRole(null)
          recordingPairRoleRef.current = null
          setRecordingTarget(target)
          return
        }

        disposeReviewAudio(nextReviewAudio)
        setReviewAudio(nextReviewAudio)
        setIsReviewDialogOpen(target.source === "subject-dialog" || target.source === "continue-context")
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

  const startAudioPairSlotRecording = async (role: PairRole) => {
    const draft = audioPairDraftRef.current
    if (!draft) return
    recordingPairRoleRef.current = role
    setAudioPairRecordingRole(role)
    await startRecording(draft.target)
  }

  const swapAudioPairDraftRoles = () => {
    setAudioPairDraft((previous) => {
      if (!previous) return previous
      const nextDraft = {
        ...previous,
        slots: {
          question: previous.slots.answer,
          answer: previous.slots.question,
        },
      }
      audioPairDraftRef.current = nextDraft
      return nextDraft
    })
  }

  const confirmReview = async () => {
    if (!recordingTarget || !reviewAudio) return
    const target = recordingTarget

    setIsUploadingAudio(true)
    setEntriesError("")

    try {
      let createdEntry = await createPracticeAudioEntry<SubjectDayEntry>({
        subjectId: target.subjectId,
        subjectName: target.subjectName,
        sessionDate: target.sessionDate,
        weekNumber: target.weekNumber,
        weekdayIndex: target.weekdayIndex,
        materialId: target.materialId ?? null,
        blob: reviewAudio.blob,
        mimeType: reviewAudio.mimeType,
      })
      if (target.source === "continue-context") {
        const featuredResponse = await fetch(`/api/subject-day-entries/${createdEntry.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ isFeatured: true }),
        })
        const featuredPayload = await requireOkJson(featuredResponse, "No se pudo guardar el audio de contexto.")
        createdEntry = featuredPayload as SubjectDayEntry
      }

      if (currentSubject?.id === target.subjectId && subjectDialogDateKey === target.sessionDate) {
        const previousEntriesSnapshot = entries
        setEntries((previousEntries) =>
          sortSubjectDayEntries(
            [
              ...previousEntries.filter((entry) => {
                if (target.source !== "continue-context" || !entry.is_featured) {
                  return true
                }

                return (
                  entry.subject_id !== target.subjectId ||
                  entry.week_number !== target.weekNumber ||
                  entry.subject_day_material_id != null
                )
              }),
              createdEntry,
            ]
          )
        )
        createdEntry = await ensureDailyEntryFeatured(createdEntry, {
          source: target.source,
          target,
          existingEntries: previousEntriesSnapshot,
        })
        if (target.source === "continue-practice" && target.materialId != null) {
          setContinuePayload((previous) =>
            previous
              ? {
                  ...previous,
                  material:
                    previous.material && previous.material.id === target.materialId
                      ? previous.material
                      : currentContinueMaterial && currentContinueMaterial.id === target.materialId
                        ? currentContinueMaterial
                        : previous.material,
                }
              : previous
          )
        }
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
    } catch (error) {
      console.error("Failed to upload audio entry:", error)
      setEntriesError(error instanceof Error ? error.message : "No se pudo confirmar el audio.")
    } finally {
      setIsUploadingAudio(false)
    }
  }

  const confirmAudioPairReview = async () => {
    const draft = audioPairDraftRef.current
    if (!draft || (!draft.slots.question && !draft.slots.answer)) return

    setIsUploadingAudio(true)
    setEntriesError("")
    const createdEntryIds: number[] = []
    const desiredRolesByEntryId = new Map<number, PairRole>()

    for (const role of ["question", "answer"] as const) {
      const slot = draft.slots[role]
      if (slot?.entryId != null) {
        desiredRolesByEntryId.set(slot.entryId, role)
      }
    }

    try {
      const createdEntries: SubjectDayEntry[] = []

      for (const role of ["question", "answer"] as const) {
        const slot = draft.slots[role]
        if (!slot) continue
        if (slot.source === "persisted" && !slot.blob) {
          if (slot.entryId != null && slot.originalRole && slot.originalRole !== role) {
            const response = await fetch(`/api/subject-day-entries/${slot.entryId}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ pairRole: role }),
            })
            const payload = await response.json()
            if (!response.ok) {
              throw new Error(getErrorMessage(payload, "No se pudo actualizar el sentido de la dupla."))
            }
            createdEntries.push(payload as SubjectDayEntry)
          }
          continue
        }

        const createdEntry = await createPracticeAudioEntry<SubjectDayEntry>({
          subjectId: draft.target.subjectId,
          subjectName: draft.target.subjectName,
          sessionDate: draft.target.sessionDate,
          weekNumber: draft.target.weekNumber,
          weekdayIndex: draft.target.weekdayIndex,
          materialId: draft.target.materialId ?? null,
          blob: slot.blob as Blob,
          mimeType: slot.mimeType,
          pairId: draft.pairId,
          pairRole: role,
        })
        if (createdEntry.pair_id !== draft.pairId || createdEntry.pair_role !== role) {
          throw new Error("La dupla de audio se guardo con metadata inconsistente.")
        }
        if (
          createdEntry.subject_id !== draft.target.subjectId ||
          createdEntry.week_number !== draft.target.weekNumber ||
          createdEntry.session_date !== draft.target.sessionDate ||
          (createdEntry.subject_day_material_id ?? null) !== (draft.target.materialId ?? null)
        ) {
          throw new Error("La dupla de audio se guardo en una sesion o material incorrecto.")
        }
        if (slot.entryId == null) {
          createdEntryIds.push(createdEntry.id)
        }
        createdEntries.push(createdEntry)
      }

      if (currentSubject?.id === draft.target.subjectId && subjectDialogDateKey === draft.target.sessionDate) {
        const createdEntriesById = new Map(createdEntries.map((entry) => [entry.id, entry]))
        const touchedEntryIds = new Set(
          Object.values(draft.slots)
            .map((slot) => slot?.entryId ?? null)
            .filter((value): value is number => Number.isInteger(value))
        )
        setEntries((previousEntries) =>
          sortSubjectDayEntries([
            ...previousEntries.map((entry) => {
              const updatedEntry = createdEntriesById.get(entry.id) ?? entry
              const desiredRole = desiredRolesByEntryId.get(entry.id)
              if (!desiredRole || updatedEntry.pair_id !== draft.pairId) {
                return updatedEntry
              }

              if (updatedEntry.pair_role === desiredRole) {
                return updatedEntry
              }

              return {
                ...updatedEntry,
                pair_role: desiredRole,
              }
            }),
            ...createdEntries.filter((entry) => !touchedEntryIds.has(entry.id)),
          ])
        )
      }

      cancelAudioPairReview()
    } catch (error) {
      console.error("Failed to upload audio pair:", error)
      for (const createdEntryId of createdEntryIds) {
        try {
          await fetch(`/api/subject-day-entries/${createdEntryId}`, { method: "DELETE" })
        } catch (cleanupError) {
          console.error("Failed to cleanup partial continue audio pair:", cleanupError)
        }
      }
      setEntriesError(error instanceof Error ? error.message : "No se pudo confirmar la dupla de audio.")
    } finally {
      setIsUploadingAudio(false)
    }
  }

  const startAnswerEdit = (entry: SubjectDayEntry) => {
    setManualEntryTarget(null)
    setManualQuestionDraft("")
    setManualAnswerDraft("")
    if (entry.pair_id) {
      const pairEntries = entries.filter((item) => item.pair_id === entry.pair_id)
      const questionEntry = pairEntries.find((item) => item.pair_role === "question") ?? entry
      const answerEntry = pairEntries.find((item) => item.pair_role === "answer") ?? null
      setEditingAnswerId(questionEntry.id)
      setQuestionDrafts((previous) => ({
        ...previous,
        [questionEntry.id]: previous[questionEntry.id] ?? questionEntry.transcript_text,
      }))
      if (answerEntry) {
        setAnswerDrafts((previous) => ({
          ...previous,
          [answerEntry.id]: previous[answerEntry.id] ?? answerEntry.transcript_text,
        }))
      }
      return
    }

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

  const startAudioPairEdit = (entry: SubjectDayEntry) => {
    const pairEntries = entry.pair_id ? entries.filter((item) => item.pair_id === entry.pair_id) : [entry]
    const questionEntry = pairEntries.find((item) => item.pair_role === "question") ?? null
    const answerEntry = pairEntries.find((item) => item.pair_role === "answer") ?? null
    const baseEntry = questionEntry ?? answerEntry ?? entry

    const target: AudioUploadTarget = {
      source: "continue-practice",
      subjectId: baseEntry.subject_id,
      subjectName: getSubjectDisplayName(getSubjectById(baseEntry.subject_id, visibleSubjects)),
      sessionDate: baseEntry.session_date,
      weekNumber: baseEntry.week_number,
      weekdayIndex: baseEntry.weekday_index,
      materialId: baseEntry.subject_day_material_id ?? null,
    }

    const nextDraft: AudioPairDraft = {
      target,
      pairId: baseEntry.pair_id ?? generatePairId(),
      slots: {
        question: questionEntry
          ? {
              url: `/api/subject-day-entries/${questionEntry.id}/audio`,
              mimeType: questionEntry.drive_mime_type || "audio/webm",
              blob: null,
              source: "persisted",
              entryId: questionEntry.id,
              originalRole: "question",
            }
          : null,
        answer: answerEntry
          ? {
              url: `/api/subject-day-entries/${answerEntry.id}/audio`,
              mimeType: answerEntry.drive_mime_type || "audio/webm",
              blob: null,
              source: "persisted",
              entryId: answerEntry.id,
              originalRole: "answer",
            }
          : null,
      },
    }

    audioPairDraftRef.current = nextDraft
    setAudioPairDraft(nextDraft)
    setAudioPairRecordingRole(null)
    recordingPairRoleRef.current = null
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
    const pairEntries = entry.pair_id ? entries.filter((item) => item.pair_id === entry.pair_id) : []
    const questionEntry = pairEntries.find((item) => item.pair_role === "question") ?? entry
    const answerEntry = pairEntries.find((item) => item.pair_role === "answer") ?? null
    const draft = answerEntry
      ? (answerDrafts[answerEntry.id] ?? answerEntry.transcript_text).trim()
      : (answerDrafts[entry.id] ?? entry.answer_text ?? "").trim()
    const questionDraft = (questionDrafts[questionEntry.id] ?? questionEntry.transcript_text).trim()
    setIsSavingAnswerId(entry.id)

    try {
      if (answerEntry) {
        const [questionResponse, answerResponse] = await Promise.all([
          fetch(`/api/subject-day-entries/${questionEntry.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ transcriptText: questionDraft || questionEntry.transcript_text }),
          }),
          fetch(`/api/subject-day-entries/${answerEntry.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ transcriptText: draft || answerEntry.transcript_text }),
          }),
        ])

        const questionPayload = await questionResponse.json()
        const answerPayload = await answerResponse.json()
        if (!questionResponse.ok) {
          throw new Error(getErrorMessage(questionPayload, "No se pudo guardar la pregunta."))
        }
        if (!answerResponse.ok) {
          throw new Error(getErrorMessage(answerPayload, "No se pudo guardar la respuesta."))
        }

        setEntries((previousEntries) =>
          sortSubjectDayEntries(
            previousEntries.map((item) => {
              if (item.id === questionEntry.id) return questionPayload as SubjectDayEntry
              if (item.id === answerEntry.id) return answerPayload as SubjectDayEntry
              return item
            })
          )
        )
        setRevealedAnswers((previous) => ({
          ...previous,
          [questionEntry.id]: false,
          [answerEntry.id]: false,
        }))
      } else {
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
        setRevealedAnswers((previous) => ({ ...previous, [entry.id]: false }))
      }
      closeAnswerDialog()
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
      let createdEntry = await createPracticeTextEntry<SubjectDayEntry>({
        subjectId: manualEntryTarget.subjectId,
        sessionDate: manualEntryTarget.sessionDate,
        weekNumber: manualEntryTarget.weekNumber,
        weekdayIndex: manualEntryTarget.weekdayIndex,
        materialId: manualEntryTarget.materialId ?? null,
        transcriptText,
        answerText,
      })

      const previousEntriesSnapshot = entries
      setEntries((previousEntries) => sortSubjectDayEntries([...previousEntries, createdEntry]))
      createdEntry = await ensureDailyEntryFeatured(createdEntry, {
        source: "manual-entry",
        target: manualEntryTarget,
        existingEntries: previousEntriesSnapshot,
      })
      if (manualEntryTarget.materialId != null) {
        setContinuePayload((previous) =>
          previous
            ? {
                ...previous,
                material:
                  previous.material && previous.material.id === manualEntryTarget.materialId
                    ? previous.material
                    : currentContinueMaterial && currentContinueMaterial.id === manualEntryTarget.materialId
                      ? currentContinueMaterial
                      : previous.material,
              }
            : previous
        )
      }
      closeAnswerDialog()
    } catch (error) {
      console.error("Failed to create manual entry:", error)
      setEntriesError(error instanceof Error ? error.message : "No se pudo crear la duda.")
    } finally {
      setIsSavingAnswerId(null)
    }
  }

  const startTitleEdit = (entry: SubjectDayEntry) => {
    const titleEntry =
      entry.pair_id
        ? entries.find((item) => item.pair_id === entry.pair_id && item.pair_role === "question") ?? entry
        : entry
    setEditingTitleId(titleEntry.id)
    setTitleDrafts((previous) => ({
      ...previous,
      [titleEntry.id]: previous[titleEntry.id] ?? getEntryDisplayTitle(titleEntry),
    }))
  }

  const saveTitle = async (entry: SubjectDayEntry) => {
    const draft = (titleDrafts[entry.id] ?? "").trim()
    setIsSavingTitleId(entry.id)

    try {
      if (entry.pair_id) {
        const pairEntries = entries.filter((item) => item.pair_id === entry.pair_id)
        const results = await Promise.all(
          pairEntries.map((pairEntry) =>
            fetch(`/api/subject-day-entries/${pairEntry.id}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ customTitle: draft || null }),
            }).then(async (response) => ({
              ok: response.ok,
              payload: await response.json(),
              id: pairEntry.id,
            }))
          )
        )

        const failed = results.find((result) => !result.ok)
        if (failed) {
          throw new Error(getErrorMessage(failed.payload, "No se pudo guardar el nombre de la dupla."))
        }

        const byId = new Map(results.map((result) => [result.id, result.payload as SubjectDayEntry]))
        setEntries((previousEntries) =>
          sortSubjectDayEntries(previousEntries.map((item) => byId.get(item.id) ?? item))
        )
      } else {
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
      }
      setEditingTitleId(null)
    } catch (error) {
      console.error("Failed to save entry title:", error)
      setEntriesError(error instanceof Error ? error.message : "No se pudo guardar el nombre de la duda.")
    } finally {
      setIsSavingTitleId(null)
    }
  }

  const openMoveEntryDialog = (entry: SubjectDayEntry) => {
    const targetEntry =
      entry.pair_id
        ? entries.find((item) => item.pair_id === entry.pair_id && item.pair_role === "question") ?? entry
        : entry
    const matchingTheoryMaterials = visibleTheoryMaterials.filter(
      (material) => material.subject_id === targetEntry.subject_id && material.week_number === targetEntry.week_number
    )

    if (matchingTheoryMaterials.length === 0) {
      setEntriesError("No hay PDFs de teoria cargados para esa materia en esa semana.")
      return
    }

    setMoveEntryTarget(targetEntry)
    setMoveEntryMaterialId(String(matchingTheoryMaterials[0].id))
  }

  const closeMoveEntryDialog = () => {
    setMoveEntryTarget(null)
    setMoveEntryMaterialId("")
  }

  const moveEntryToTheoryMaterial = async () => {
    if (!moveEntryTarget || !moveEntryMaterialId) return

    const targetMaterialId = Number.parseInt(moveEntryMaterialId, 10)
    if (!Number.isInteger(targetMaterialId)) {
      setEntriesError("Selecciona un PDF de teoria valido.")
      return
    }

    const entriesToMove = moveEntryTarget.pair_id
      ? entries.filter((item) => item.pair_id === moveEntryTarget.pair_id)
      : [moveEntryTarget]

    setIsMovingEntryId(moveEntryTarget.id)
    try {
      const results = await Promise.all(
        entriesToMove.map((entry) =>
          fetch(`/api/subject-day-entries/${entry.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ targetMaterialId }),
          }).then(async (response) => ({
            ok: response.ok,
            payload: await response.json(),
            id: entry.id,
          }))
        )
      )

      const failed = results.find((result) => !result.ok)
      if (failed) {
        throw new Error(getErrorMessage(failed.payload, "No se pudo mover la duda al PDF de teoria."))
      }

      const byId = new Map(results.map((result) => [result.id, result.payload as SubjectDayEntry]))
      setEntries((previousEntries) => sortSubjectDayEntries(previousEntries.map((item) => byId.get(item.id) ?? item)))
      closeMoveEntryDialog()
      toast({ title: "Duda movida", description: "La duda se llevo al PDF de teoria." })
    } catch (error) {
      console.error("Failed to move entry to theory material:", error)
      setEntriesError(error instanceof Error ? error.message : "No se pudo mover la duda al PDF de teoria.")
    } finally {
      setIsMovingEntryId(null)
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
    if (continueGroups.length === 0 || isCopyingEntries) return

    setIsCopyingEntries(true)
    setContinueError("")
    try {
      const payload = continueGroups
        .map((group) => {
          if (group.kind === "pair") {
            const title = getEntryDisplayTitle(group.titleEntry)
            const question = group.questionEntry.transcript_text?.trim() || ""
            const answer = group.answerEntry.transcript_text?.trim() || ""
            return `${title}\nPregunta: ${question}\nRespuesta: ${answer}`
          }

          const title = getEntryDisplayTitle(group.entry)
          const transcript = group.entry.transcript_text?.trim() || ""
          const answer = group.entry.answer_text?.trim() || ""
          return `${title}\nTranscripcion: ${transcript}\nRespuesta: ${answer}`
        })
        .join("\n\n")

      await navigator.clipboard.writeText(payload)
      toast({ title: "Copiado", description: "Contenido copiado al portapapeles" })
    } catch (error) {
      console.error("Failed to copy continue entries:", error)
      setContinueError("No se pudieron copiar las dudas.")
      toast({ title: "Error", description: "No se pudieron copiar las dudas.", variant: "destructive" })
    } finally {
      window.setTimeout(() => setIsCopyingEntries(false), 600)
    }
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

  const promoteEntryToSubjectAnchor = async (entry: SubjectDayEntry) => {
    setEntriesError("")
    try {
      const updatedEntry = await persistFeaturedEntry(entry.id, true, "subject_week")
      applySubjectWeekFeaturedEntryLocally(updatedEntry)
      toast({ title: "Ancla actualizada", description: "La dupla ahora cuenta como ancla abstracta de la materia." })
    } catch (error) {
      console.error("Failed to promote entry to subject anchor:", error)
      setEntriesError(error instanceof Error ? error.message : "No se pudo promover la dupla a ancla.")
      toast({ title: "Error", description: "No se pudo promover la dupla a ancla.", variant: "destructive" })
    }
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

      const deletedIds = Array.isArray(payload?.ids) && payload.ids.length > 0 ? payload.ids : [entry.id]
      const deletedIdSet = new Set<number>(deletedIds)

      setEntries((previousEntries) =>
        sortSubjectDayEntries(previousEntries.filter((item) => !deletedIdSet.has(item.id)))
      )
      setPracticeEntries((previousEntries) => previousEntries.filter((item) => !deletedIdSet.has(item.id)))
      setPracticeVisibleEntries((previousEntries) => previousEntries.filter((item) => !deletedIdSet.has(item.id)))

      setRevealedAnswers((previous) => {
        const next = { ...previous }
        for (const deletedId of deletedIds) {
          delete next[deletedId]
        }
        return next
      })
      setAnswerDrafts((previous) => {
        const next = { ...previous }
        for (const deletedId of deletedIds) {
          delete next[deletedId]
        }
        return next
      })
      setQuestionDrafts((previous) => {
        const next = { ...previous }
        for (const deletedId of deletedIds) {
          delete next[deletedId]
        }
        return next
      })
      setTitleDrafts((previous) => {
        const next = { ...previous }
        for (const deletedId of deletedIds) {
          delete next[deletedId]
        }
        return next
      })

      if (editingAnswerId != null && deletedIdSet.has(editingAnswerId)) setEditingAnswerId(null)
      if (editingTitleId != null && deletedIdSet.has(editingTitleId)) setEditingTitleId(null)
      if (expandedAudioEntryId != null && deletedIdSet.has(expandedAudioEntryId)) {
        audioElementRefs.current[expandedAudioEntryId]?.pause()
        setExpandedAudioEntryId(null)
      }

      setContinuePayload((previous) =>
        previous?.previousFeaturedEntry?.id != null && deletedIdSet.has(previous.previousFeaturedEntry.id)
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

  const loadSubjectShortcuts = useCallback(async (subjectId: string) => {
    try {
      await loadSubjectShortcutsData(subjectId)
    } catch (error) {
      setSubjectShortcuts(getEmptySubjectShortcuts(subjectId))
      setEntriesError(error instanceof Error ? error.message : "No se pudieron cargar los accesos directos de la materia.")
    }
  }, [loadSubjectShortcutsData, setSubjectShortcuts])

  useEffect(() => {
    if (isDialogOpen && currentSubject) {
      void loadSubjectShortcuts(currentSubject.id)
      return
    }

    if (!isPracticeOpen || practiceLaunchView !== "theory" || !practiceSubjectId) return
    void loadSubjectShortcuts(practiceSubjectId)
  }, [currentSubject, isDialogOpen, isPracticeOpen, loadSubjectShortcuts, practiceLaunchView, practiceSubjectId])

  const closeShortcutDialog = () => {
    setIsShortcutDialogOpen(false)
    setShortcutDraft("")
    setShortcutDialogKey(null)
    setShortcutDialogMode("create")
  }

  const openShortcutDialog = (shortcutKey: SubjectShortcutKey, mode: "create" | "edit") => {
    const currentUrl = getShortcutUrl(subjectShortcuts, shortcutKey) ?? ""
    setShortcutDialogKey(shortcutKey)
    setShortcutDialogMode(mode)
    setShortcutDraft(currentUrl)
    setIsShortcutDialogOpen(true)
  }

  const saveSubjectShortcut = async () => {
    const subjectId = activeShortcutSubject?.id
    if (!subjectId || !shortcutDialogKey) return

    setIsSavingShortcut(true)
    try {
      await persistSubjectShortcut({
        subjectId,
        shortcutKey: shortcutDialogKey,
        url: shortcutDraft.trim(),
      })
      closeShortcutDialog()
    } catch (error) {
      console.error("Failed to save subject shortcut:", error)
      setEntriesError(error instanceof Error ? error.message : "No se pudo guardar el acceso directo.")
    } finally {
      setIsSavingShortcut(false)
    }
  }

  const clearShortcutLongPressTimer = () => {
    if (shortcutLongPressTimerRef.current !== null) {
      window.clearTimeout(shortcutLongPressTimerRef.current)
      shortcutLongPressTimerRef.current = null
    }
  }

  const handleShortcutPointerDown = (shortcutKey: SubjectShortcutKey) => {
    shouldSuppressShortcutClickRef.current = false
    clearShortcutLongPressTimer()
    shortcutLongPressTimerRef.current = window.setTimeout(() => {
      shouldSuppressShortcutClickRef.current = true
      openShortcutDialog(shortcutKey, getShortcutUrl(subjectShortcuts, shortcutKey) ? "edit" : "create")
      shortcutLongPressTimerRef.current = null
    }, 700)
  }

  const handleShortcutPointerUp = () => {
    clearShortcutLongPressTimer()
  }

  const handleShortcutPointerCancel = () => {
    clearShortcutLongPressTimer()
    shouldSuppressShortcutClickRef.current = false
  }

  const handleShortcutClick = (shortcutKey: SubjectShortcutKey) => {
    if (shouldSuppressShortcutClickRef.current) {
      shouldSuppressShortcutClickRef.current = false
      return
    }

    const url = getShortcutUrl(subjectShortcuts, shortcutKey)
    if (url) {
      window.open(url, "_blank", "noopener,noreferrer")
      return
    }

    openShortcutDialog(shortcutKey, "create")
  }

  const handleMaterialUpload = async (materialType: SubjectDayMaterialType, files: File[]) => {
    if (!currentSubject || files.length === 0) return

    const validFiles = files.filter((file) => isPdfFile(file))
    const skippedFiles = files.filter((file) => !isPdfFile(file))

    if (validFiles.length === 0) {
      setEntriesError("Solo se permiten archivos PDF.")
      return
    }

    const subjectSnapshot = currentSubject
    const subjectId = subjectSnapshot.id
    const subjectName = getSubjectDisplayName(subjectSnapshot)
    const weekNumber = dialogSelectedWeekNumber
    const sessionDate = subjectDialogDateKey
    const weekdayIndex = subjectDialogDayIndex >= 0 ? subjectDialogDayIndex : 0

    setEntriesError("")
    const failedUploads = await uploadMaterials({
      subjectId,
      subjectName,
      sessionDate,
      weekNumber,
      materialType,
      files: validFiles,
      buildPendingMaterials: (uploadFiles) => {
        const baseOrderIndex =
          (materialType === "theory" ? theoryMaterials.length : practiceMaterials.length) +
          pendingMaterials.filter((material) => material.material_type === materialType).length

        return uploadFiles.map((file, index) => {
          const tempId = -(Date.now() + index + 1)
          return {
            tempId,
            file,
            pendingMaterial: {
              id: tempId,
              subject_id: subjectId,
              week_number: weekNumber,
              session_date: sessionDate,
              weekday_index: weekdayIndex,
              material_type: materialType,
              order_index: baseOrderIndex + index + 1,
              file_name: file.name,
              drive_file_id: "",
              drive_mime_type: "application/pdf",
              drive_web_view_link: "",
              is_checkup_done: false,
              created_at: "",
              updated_at: "",
              is_pending_upload: true as const,
            } satisfies PendingSubjectDayMaterial,
          }
        })
      },
      mergeMaterials: (previousMaterials, incomingMaterials) =>
        mergeSubjectDayMaterials(previousMaterials, incomingMaterials),
      setMaterials,
      setPendingMaterials,
    })

    if (failedUploads.length > 0) {
      setEntriesError(failedUploads.join(" | "))
    } else if (skippedFiles.length > 0) {
      setEntriesError("")
    }

    if (skippedFiles.length > 0) {
      toast({
        title: "Archivos ignorados",
        description:
          skippedFiles.length === 1
            ? `${skippedFiles[0].name} no es un PDF valido.`
            : `Se ignoraron ${skippedFiles.length} archivos que no eran PDF.`,
        variant: "destructive",
      })
    }
  }

  const loadContinuePayload = async (
    mode: ContinueMode = continueMode,
    { silent = false }: { silent?: boolean } = {}
  ) => {
    if (!currentSubject) return
    const localPayload = buildLocalContinuePayload(mode)

    if (!silent && !localPayload) {
      setIsContinueLoading(true)
    }
    setContinueError("")

    try {
      const params = new URLSearchParams({
        subjectId: currentSubject.id,
        sessionDate: subjectDialogDateKey,
        weekNumber: String(dialogSelectedWeekNumber),
      })

      const response = await fetch(`/api/subject-day-materials/next-${mode}?${params.toString()}`)
      const payload = await response.json()
      if (!response.ok) {
        throw new Error(getErrorMessage(payload, `No se pudo cargar el siguiente PDF de ${getContinueModeLabel(mode)}.`))
      }

      const serverPayload = {
        mode,
        ...(payload as Omit<ContinuePayload, "mode">),
      }

      setContinuePayload((previous) => {
        const resolvedMaterial = localPayload?.material ?? previous?.material ?? serverPayload.material
        const previousFeaturedEntry =
          getLocalContinueFeaturedEntry() ??
          localPayload?.previousFeaturedEntry ??
          previous?.previousFeaturedEntry ??
          serverPayload.previousFeaturedEntry

        return {
          ...serverPayload,
          material: resolvedMaterial,
          previousFeaturedEntry,
        }
      })
    } catch (error) {
      console.error(`Failed to load next ${mode} material:`, error)
      setContinuePayload((previous) => previous ?? localPayload)
      setContinueError(error instanceof Error ? error.message : `No se pudo cargar el siguiente PDF de ${getContinueModeLabel(mode)}.`)
    } finally {
      if (!silent && !localPayload) {
        setIsContinueLoading(false)
      }
    }
  }

  const openContinueModal = async (mode: ContinueMode = continueMode, materialId?: number) => {
    const availableMaterials = getVisibleMaterialsForMode(mode)
    const selectedMaterial = resolveContinueMaterial(availableMaterials, materialId)

    setContinueMode(mode)
    setSelectedPracticeMaterialId(selectedMaterial?.id ?? null)

    const localPayload: ContinuePayload | null = currentSubject
      ? {
          mode,
          material: selectedMaterial,
          previousFeaturedEntry: getLocalContinueFeaturedEntry() ?? continuePayload?.previousFeaturedEntry ?? null,
        }
      : null

    setContinuePayload(localPayload)
    setIsContinueOpen(true)
    setContinueError(
      availableMaterials.length === 0
        ? ""
        : selectedMaterial
          ? ""
          : `No se pudo resolver un PDF de ${getContinueModeLabel(mode)} para continuar.`
    )

    void loadContinuePayload(mode, { silent: Boolean(localPayload) })
  }

  const toggleMaterialCheckup = async (materialToUpdate: SubjectDayMaterial, checked: boolean) => {
    const mode: ContinueMode = materialToUpdate.material_type === "theory" ? "theory" : "practice"
    const isCurrentContinueMaterial = currentContinueMaterial?.id === materialToUpdate.id
    const previousPayload = continuePayload
    const optimisticMaterial = { ...materialToUpdate, is_checkup_done: checked }
    const nextMaterials = sortSubjectDayMaterials(
      getVisibleMaterialsForMode(mode).map((material) => (material.id === optimisticMaterial.id ? optimisticMaterial : material))
    )
    const existingTimer = pendingMaterialCheckupTimersRef.current.get(materialToUpdate.id)
    const nextContinueMaterial =
      currentSubject && isCurrentContinueMaterial
        ? getNextUncheckedMaterial(nextMaterials, {
            mode,
            subjectId: currentSubject.id,
            sessionDate: subjectDialogDateKey,
            weekNumber: dialogSelectedWeekNumber,
          })
        : null

    if (existingTimer) {
      window.clearTimeout(existingTimer)
      pendingMaterialCheckupTimersRef.current.delete(materialToUpdate.id)
    }

    setContinueError("")
    if (isCurrentContinueMaterial) {
      setSelectedPracticeMaterialId(checked ? nextContinueMaterial?.id ?? null : optimisticMaterial.id)
      setContinuePayload((previous) =>
        previous
          ? {
              ...previous,
              mode,
              material: checked ? nextContinueMaterial : optimisticMaterial,
            }
          : previous
      )
    }
    setMaterials((previousMaterials) =>
      sortSubjectDayMaterials(
        previousMaterials.map((material) => (material.id === optimisticMaterial.id ? optimisticMaterial : material))
      )
    )

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
          setSelectedPracticeMaterialId(updatedMaterial.id)
          setContinuePayload((previous) => (previous ? { ...previous, material: updatedMaterial } : previous))
        }
      } catch (error) {
        console.error(`Failed to update ${mode} material checkup:`, error)
        if (isCurrentContinueMaterial) {
          setSelectedPracticeMaterialId(materialToUpdate.id)
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

    const mode: ContinueMode = materialToDelete.material_type === "theory" ? "theory" : "practice"
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
        const remainingMaterials = getVisibleMaterialsForMode(mode).filter((material) => material.id !== materialToDelete.id)
        const nextMaterial = getNextUncheckedMaterial(remainingMaterials, {
          mode,
          subjectId: currentSubject.id,
          sessionDate: subjectDialogDateKey,
          weekNumber: dialogSelectedWeekNumber,
        })
        setSelectedPracticeMaterialId(nextMaterial?.id ?? null)
        setContinuePayload((previous) =>
          previous
            ? {
                ...previous,
                mode,
                material: nextMaterial,
              }
            : previous
        )
      } else if (selectedPracticeMaterialId === materialToDelete.id) {
        setSelectedPracticeMaterialId(null)
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
      setEntriesError(error instanceof Error ? error.message : "No se pudo reproducir el audio.")
    } finally {
      setLoadingAudioEntryId(null)
    }
  }

  const resetSynthesisPlayback = useCallback(() => {
    const audio = synthesisPlaybackAudioRef.current
    if (audio) {
      audio.pause()
      audio.removeAttribute("src")
      audio.load()
    }

    setSynthesisPlaybackQueue([])
    setSynthesisPlaybackIndex(-1)
    setIsSynthesisPlaybackActive(false)
  }, [])

  const runSynthesisAutosave = useCallback(async (pendingSave: PendingSynthesisSave) => {
    const currentState = synthesisSubjectStateMapRef.current[pendingSave.subjectId]
    if (!currentState) return

    setSynthesisSubjectStateMap((previous) => ({
      ...previous,
      [pendingSave.subjectId]: {
        ...(previous[pendingSave.subjectId] ?? buildEmptySynthesisSubjectState(pendingSave.subjectId, pendingSave.weekNumber)),
        isSaving: true,
        error: "",
      },
    }))

    try {
      const nextPayload = await saveSubjectSynthesisMaterials({
        subjectId: pendingSave.subjectId,
        weekNumber: pendingSave.weekNumber,
        items: currentState.materials
          .filter((material) => material.material_type === "practice")
          .map((material) => {
            const draft = currentState.drafts[material.id] ?? createEmptySynthesisMaterialDraft()
            return {
              subjectDayMaterialId: material.id,
              exerciseScopeText: draft.exerciseScopeText,
              exerciseSolvedCount: getSynthesisDraftNumber(draft.exerciseSolvedCount),
              exerciseTotalCount: getSynthesisDraftNumber(draft.exerciseTotalCount),
            }
          }),
      })

      setSynthesisSubjectStateMap((previous) => {
        if (synthesisWeekNumberRef.current !== pendingSave.weekNumber) return previous
        return {
          ...previous,
          [pendingSave.subjectId]: buildSynthesisSubjectState(nextPayload),
        }
      })
    } catch (error) {
      console.error("Failed to autosave synthesis progress:", error)
      setSynthesisSubjectStateMap((previous) => {
        if (synthesisWeekNumberRef.current !== pendingSave.weekNumber) return previous
        return {
          ...previous,
          [pendingSave.subjectId]: {
            ...(previous[pendingSave.subjectId] ?? buildEmptySynthesisSubjectState(pendingSave.subjectId, pendingSave.weekNumber)),
            isSaving: false,
            error: error instanceof Error ? error.message : "No se pudo guardar la sintesis por archivo.",
          },
        }
      })
    }
  }, [])

  const scheduleSynthesisAutosave = useCallback((pendingSave: PendingSynthesisSave) => {
    const existingTimerId = synthesisAutosaveTimersRef.current.get(pendingSave.subjectId)
    if (existingTimerId != null) {
      window.clearTimeout(existingTimerId)
    }

    const timerId = window.setTimeout(() => {
      synthesisAutosaveTimersRef.current.delete(pendingSave.subjectId)
      void runSynthesisAutosave(pendingSave)
    }, 10000)

    synthesisAutosaveTimersRef.current.set(pendingSave.subjectId, timerId)
  }, [runSynthesisAutosave])

  const flushPendingSynthesisAutosaves = useCallback((subjectId?: string) => {
    const targets = subjectId
      ? [subjectId]
      : Array.from(synthesisAutosaveTimersRef.current.keys())

    targets.forEach((targetSubjectId) => {
      const timerId = synthesisAutosaveTimersRef.current.get(targetSubjectId)
      if (timerId != null) {
        window.clearTimeout(timerId)
        synthesisAutosaveTimersRef.current.delete(targetSubjectId)
      }

      void runSynthesisAutosave({
        subjectId: targetSubjectId,
        weekNumber: synthesisWeekNumberRef.current,
      })
    })
  }, [runSynthesisAutosave])

  const openSynthesisModal = useCallback(() => {
    const firstSubject = synthesisSubjects[0] ?? null
    if (!firstSubject) return

    resetSynthesisPlayback()
    setSynthesisWeekNumber(homeSelectedWeekNumber)
    setSynthesisSubjectId(firstSubject.id)
    setSynthesisSubjectStateMap({})
    setIsSynthesisWeekSelectorOpen(false)
    setIsSynthesisOpen(true)
  }, [homeSelectedWeekNumber, resetSynthesisPlayback, synthesisSubjects])

  const closeSynthesisModal = useCallback(() => {
    flushPendingSynthesisAutosaves()
    resetSynthesisPlayback()
    setIsSynthesisOpen(false)
    setIsSynthesisWeekSelectorOpen(false)
  }, [flushPendingSynthesisAutosaves, resetSynthesisPlayback])

  const handleSelectSynthesisWeek = useCallback((weekNumber: number) => {
    const firstSubject = synthesisSubjects[0] ?? null
    if (!firstSubject) return

    flushPendingSynthesisAutosaves()
    resetSynthesisPlayback()
    setSynthesisWeekNumber(weekNumber)
    setSynthesisSubjectId(firstSubject.id)
    setIsSynthesisWeekSelectorOpen(false)
  }, [flushPendingSynthesisAutosaves, resetSynthesisPlayback, synthesisSubjects])

  const handleSynthesisPreviousSubject = useCallback(() => {
    if (synthesisSubjectIndex <= 0) {
      setIsSynthesisWeekSelectorOpen(true)
      return
    }

    resetSynthesisPlayback()
    setSynthesisSubjectId(synthesisSubjects[synthesisSubjectIndex - 1]?.id ?? synthesisSubjectId)
  }, [resetSynthesisPlayback, synthesisSubjectId, synthesisSubjectIndex, synthesisSubjects])

  const handleSynthesisNextSubject = useCallback(() => {
    if (synthesisSubjectIndex < 0 || synthesisSubjectIndex >= synthesisSubjects.length - 1) return

    resetSynthesisPlayback()
    setSynthesisSubjectId(synthesisSubjects[synthesisSubjectIndex + 1]?.id ?? synthesisSubjectId)
  }, [resetSynthesisPlayback, synthesisSubjectId, synthesisSubjectIndex, synthesisSubjects])

  const handleStartSynthesisPlayback = useCallback((mode: ContinueMode) => {
    const entriesByMaterialId = (synthesisSelectedState?.entries ?? []).reduce<Record<number, SubjectDayEntry[]>>((accumulator, entry) => {
      if (entry.subject_day_material_id == null) return accumulator
      const materialId = entry.subject_day_material_id
      const current = accumulator[materialId] ?? []
      current.push(entry)
      accumulator[materialId] = current
      return accumulator
    }, {})
    const materialsForMode = sortSubjectDayMaterials(
      (synthesisSelectedState?.materials ?? []).filter((material) => material.material_type === mode)
    )
    const nextQueue = buildSynthesisPlaybackQueue(materialsForMode, entriesByMaterialId)
    if (nextQueue.length === 0) return

    setSynthesisPlaybackQueue(nextQueue)
    setSynthesisPlaybackIndex(0)
    setIsSynthesisPlaybackActive(true)
  }, [synthesisSelectedState])

  const handlePauseResumeSynthesisPlayback = useCallback(() => {
    if (synthesisPlaybackQueue.length === 0) return
    setIsSynthesisPlaybackActive((previous) => !previous)
  }, [synthesisPlaybackQueue.length])

  const handleSkipSynthesisPlayback = useCallback(() => {
    if (synthesisPlaybackQueue.length === 0) return

    setSynthesisPlaybackIndex((previous) => {
      const nextIndex = previous + 1
      if (nextIndex >= synthesisPlaybackQueue.length) {
        setIsSynthesisPlaybackActive(false)
        return -1
      }

      return nextIndex
    })
  }, [synthesisPlaybackQueue.length])

  const handleSynthesisAudioEnded = useCallback(() => {
    if (synthesisPlaybackQueue.length === 0) return

    setSynthesisPlaybackIndex((previous) => {
      const nextIndex = previous + 1
      if (nextIndex >= synthesisPlaybackQueue.length) {
        setIsSynthesisPlaybackActive(false)
        return -1
      }

      return nextIndex
    })
  }, [synthesisPlaybackQueue.length])

  const handleSynthesisDraftChange = useCallback(
    (materialId: number, field: keyof SynthesisMaterialDraft, value: string) => {
      if (!synthesisSelectedSubject) return

      setSynthesisSubjectStateMap((previous) => {
        const current = previous[synthesisSelectedSubject.id] ?? buildEmptySynthesisSubjectState(synthesisSelectedSubject.id, synthesisWeekNumber)
        const nextDrafts = {
          ...current.drafts,
          [materialId]: {
            ...(current.drafts[materialId] ?? createEmptySynthesisMaterialDraft()),
            [field]: field === "exerciseScopeText" ? value : value.replace(/[^\d]/g, ""),
          },
        }

        return {
          ...previous,
          [synthesisSelectedSubject.id]: {
            ...current,
            drafts: nextDrafts,
          },
        }
      })

      scheduleSynthesisAutosave({
        subjectId: synthesisSelectedSubject.id,
        weekNumber: synthesisWeekNumber,
      })
    },
    [scheduleSynthesisAutosave, synthesisSelectedSubject, synthesisWeekNumber]
  )

  const handleSynthesisDraftCommit = useCallback(() => {
    if (!synthesisSelectedSubject) return
    scheduleSynthesisAutosave({
      subjectId: synthesisSelectedSubject.id,
      weekNumber: synthesisWeekNumber,
    })
  }, [scheduleSynthesisAutosave, synthesisSelectedSubject, synthesisWeekNumber])

  const openSynthesisMaterial = useCallback(async (material: SubjectDayMaterial, mode: ContinueMode) => {
    await flushPendingFeaturedUpdate()
    const subject = synthesisSelectedSubject
    if (!subject) return

    flushPendingSynthesisAutosaves(subject.id)
    resetSynthesisPlayback()
    setCurrentSubject(subject)
    setDialogDateKey(material.session_date)
    resetSubjectUiState()
    setPracticeSectionView(mode === "theory" ? "theory" : "exercises")
    setExerciseWeeklyScopeEnabled(false)
    setSelectedPracticeMaterialId(material.id)
    setIsSynthesisOpen(false)
    setIsDialogOpen(true)
  }, [flushPendingFeaturedUpdate, flushPendingSynthesisAutosaves, resetSynthesisPlayback, resetSubjectUiState, synthesisSelectedSubject])

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
    setDialogDateKey(currentDateKey)
    resetSubjectUiState()
    setSubjectDialogEntryMode("default")
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
    setReviewSubjectId(subjectId)
    await loadSubjectReviewEntries(subjectId)
  }

  const loadPracticeEntries = async (subjectId: string, weekNumberValue = practiceWeekNumber, filters = practiceFilters) => {
    const normalizedWeekNumber = Number.parseInt(weekNumberValue, 10)
    setPracticeSubjectId(subjectId)
    setPracticeWeekNumber(Number.isNaN(normalizedWeekNumber) ? weekNumberValue : String(normalizedWeekNumber))
    setCurrentPracticeIndex(0)
    setIsPracticeFinished(false)
    setIsAnswerRevealed(false)
    const normalizedEntries = await loadSubjectPracticeEntries({
      subjectId,
      weekNumber: weekNumberValue,
      applyFilters: (entries) => applyPracticeFilters(entries, filters, { shuffle: true }),
      onResolvedSubject: (subjectIndex) => {
        setPracticeSubjectIndex(subjectIndex)
        setPracticeWeekNumber(String(normalizedWeekNumber))
      },
      onFailedValidation: () => {
        setPracticeSubjectId("")
        setPracticeSubjectIndex(null)
        setPracticeEntries([])
        setPracticeVisibleEntries([])
      },
    })

    setPracticeVisibleEntries(normalizedEntries)
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
    () => getDisplaySubjectsForDate(dialogSelectedDate, dialogShowAllSubjectsForDay, visibleSubjects),
    [dialogSelectedDate, dialogShowAllSubjectsForDay, visibleSubjects]
  )
  const latestWeekNumber = currentCalendarWeek
  const theoryMaterials = useMemo(
    () =>
      sortSubjectDayMaterials(
        [...materials, ...pendingMaterials].filter((material) =>
          material.material_type === "theory" && (!isWeeklyExercisesScope || material.week_number === dialogSelectedWeekNumber)
        )
      ),
    [dialogSelectedWeekNumber, isWeeklyExercisesScope, materials, pendingMaterials]
  )
  const practiceMaterials = useMemo(
    () =>
      sortSubjectDayMaterials(
        [...materials, ...pendingMaterials].filter((material) =>
          material.material_type === "practice" && (!isWeeklyExercisesScope || material.week_number === dialogSelectedWeekNumber)
        )
      ),
    [dialogSelectedWeekNumber, isWeeklyExercisesScope, materials, pendingMaterials]
  )
  const activeDayEntries = useMemo(
    () =>
      isWeeklyExercisesScope
        ? entries.filter((entry) => entry.week_number === dialogSelectedWeekNumber)
        : entries.filter((entry) => entry.session_date === subjectDialogDateKey),
    [dialogSelectedWeekNumber, entries, isWeeklyExercisesScope, subjectDialogDateKey]
  )
  const isTheoryContinueMode = subjectDialogEntryMode === "theory_continue"
  const theoryDayEntries = useMemo(
    () =>
      activeDayEntries.filter(
        (entry) =>
          shouldRenderInTheoryView(entry) &&
          (!isWeeklyExercisesScope || entry.week_number === dialogSelectedWeekNumber)
      ),
    [activeDayEntries, dialogSelectedWeekNumber, isWeeklyExercisesScope]
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
  const currentSubjectOverview = currentSubjectOverviewLoad.selectedVector
  const synthesisEntriesByMaterialId = useMemo(() => {
    return (synthesisSelectedState?.entries ?? []).reduce<Record<number, SubjectDayEntry[]>>((accumulator, entry) => {
      if (entry.subject_day_material_id == null) return accumulator
      const materialId = entry.subject_day_material_id
      const current = accumulator[materialId] ?? []
      current.push(entry)
      accumulator[materialId] = current
      return accumulator
    }, {})
  }, [synthesisSelectedState?.entries])
  const synthesisTheoryMaterials = useMemo(
    () => sortSubjectDayMaterials((synthesisSelectedState?.materials ?? []).filter((material) => material.material_type === "theory")),
    [synthesisSelectedState?.materials]
  )
  const synthesisPracticeMaterials = useMemo(
    () => sortSubjectDayMaterials((synthesisSelectedState?.materials ?? []).filter((material) => material.material_type === "practice")),
    [synthesisSelectedState?.materials]
  )
  const synthesisTheoryQueue = useMemo(
    () => buildSynthesisPlaybackQueue(synthesisTheoryMaterials, synthesisEntriesByMaterialId),
    [synthesisEntriesByMaterialId, synthesisTheoryMaterials]
  )
  const synthesisPracticeQueue = useMemo(
    () => buildSynthesisPlaybackQueue(synthesisPracticeMaterials, synthesisEntriesByMaterialId),
    [synthesisEntriesByMaterialId, synthesisPracticeMaterials]
  )
  const currentSynthesisPlaybackItem =
    synthesisPlaybackIndex >= 0 && synthesisPlaybackIndex < synthesisPlaybackQueue.length
      ? synthesisPlaybackQueue[synthesisPlaybackIndex]
      : null
  const synthesisExerciseMaterials = synthesisPracticeMaterials
  const hasSynthesisPerMaterialProgress = synthesisSelectedSummary?.hasPerMaterialProgress ?? false
  const isSynthesisLoading = synthesisSelectedState?.isLoading ?? false
  const isSynthesisSaving = synthesisSelectedState?.isSaving ?? false
  const synthesisError = synthesisSelectedState?.error ?? ""
  const synthesisHeaderLabel = useMemo(
    () =>
      getSynthesisHeaderLabel({
        subject: synthesisSelectedSubject,
        percentage: synthesisSelectedSummary?.percentage ?? 0,
        weekNumber: synthesisWeekNumber,
        currentWeekNumber: currentCalendarWeek,
        referenceDate: homeSelectedDate,
      }),
    [currentCalendarWeek, homeSelectedDate, synthesisSelectedSubject, synthesisSelectedSummary?.percentage, synthesisWeekNumber]
  )
  const synthesisWeekOptions = useMemo(
    () => Array.from({ length: currentCalendarWeek + 1 }, (_, index) => currentCalendarWeek - index),
    [currentCalendarWeek]
  )
  const currentSubjectPracticeCoverage = useMemo(() => {
    return buildMaterialCoverage(practiceMaterials, practiceEntriesByMaterialId)
  }, [practiceEntriesByMaterialId, practiceMaterials])
  const currentSubjectTheoryCoverage = useMemo(
    () => buildMaterialCoverage(theoryMaterials, practiceEntriesByMaterialId),
    [practiceEntriesByMaterialId, theoryMaterials]
  )
  const currentSubjectVectorSummary = useMemo(() => {
    const firstTheoryMaterial = theoryMaterials[0] ?? null
    const hasTheory = Boolean(currentSubjectOverview?.startDate || firstTheoryMaterial)
    const relevantCoverage = isTheoryContinueMode
      ? currentSubjectTheoryCoverage
      : currentSubjectOverview
        ? currentSubjectPracticeCoverage.filter((material) =>
            currentSubjectOverview.relevantPracticeMaterialIds.includes(material.id)
          )
        : currentSubjectPracticeCoverage
    const coveredCount = relevantCoverage.filter((material) => material.status === "cubierto_minimo").length

    return {
      hasVector: Boolean(currentSubjectOverview),
      hasTheory,
      startDate: currentSubjectOverview?.startDate ?? firstTheoryMaterial?.session_date ?? null,
      currentDay: currentSubjectOverview?.currentDay ?? null,
      relevantCount: isTheoryContinueMode
        ? relevantCoverage.length
        : currentSubjectOverview
          ? currentSubjectOverview.relevantPracticeMaterialIds.length
          : relevantCoverage.length,
      coveredCount,
      totalCount: isTheoryContinueMode
        ? currentSubjectTheoryCoverage.length
        : currentSubjectOverview?.totalPracticeMaterialIds.length ?? currentSubjectPracticeCoverage.length,
      stateLabel: currentSubjectOverview?.stateLabel ?? (hasTheory ? "parcial" : "sin_teoria"),
      severity: currentSubjectOverview?.severity ?? ("yellow" as const),
      staleReason: isTheoryContinueMode ? [] : currentSubjectOverview?.staleReason ?? [],
      lastInteractionAt: currentSubjectOverview?.lastInteractionAt ?? null,
      fragileConcepts: isTheoryContinueMode
        ? []
        : entries.filter((entry) => entry.practice_state === "erre"),
    }
  }, [
    currentSubjectOverview,
    currentSubjectPracticeCoverage,
    currentSubjectTheoryCoverage,
    entries,
    isTheoryContinueMode,
    theoryMaterials,
  ])
  const selectedContinueMaterialEntries = useMemo(
    () => (selectedPracticeMaterialId ? entries.filter((entry) => entry.subject_day_material_id === selectedPracticeMaterialId) : []),
    [entries, selectedPracticeMaterialId]
  )
  const selectedPracticeMaterial = useMemo(
    () => practiceMaterials.find((material) => !("is_pending_upload" in material) && material.id === selectedPracticeMaterialId) ?? null,
    [practiceMaterials, selectedPracticeMaterialId]
  )
  const selectedTheoryMaterial = useMemo(
    () => theoryMaterials.find((material) => !("is_pending_upload" in material) && material.id === selectedPracticeMaterialId) ?? null,
    [selectedPracticeMaterialId, theoryMaterials]
  )
  const selectedContinueMaterial = continueMode === "theory" ? selectedTheoryMaterial : selectedPracticeMaterial
  const currentContinueMaterial =
    continueMode === "theory"
      ? selectedTheoryMaterial ?? continuePayload?.material ?? null
      : selectedPracticeMaterial ?? continuePayload?.material ?? null
  const visiblePracticeMaterials = useMemo(
    () => practiceMaterials.filter((material): material is SubjectDayMaterial => !("is_pending_upload" in material)),
    [practiceMaterials]
  )
  const visibleTheoryMaterials = useMemo(
    () => theoryMaterials.filter((material): material is SubjectDayMaterial => !("is_pending_upload" in material)),
    [theoryMaterials]
  )
  const materialById = useMemo(
    () =>
      [...materials, ...pendingMaterials].reduce<Record<number, SubjectDayMaterial>>((accumulator, material) => {
        accumulator[material.id] = material
        return accumulator
      }, {}),
    [materials, pendingMaterials]
  )
  const moveEntryMaterialOptions = useMemo(
    () =>
      moveEntryTarget
        ? visibleTheoryMaterials.filter(
            (material) =>
              material.subject_id === moveEntryTarget.subject_id && material.week_number === moveEntryTarget.week_number
          )
        : [],
    [moveEntryTarget, visibleTheoryMaterials]
  )
  const canMoveEntryToTheory = useCallback(
    (entry: SubjectDayEntry) => {
      if (entry.subject_day_material_id == null) return false
      const material = materialById[entry.subject_day_material_id]
      if (!material || material.material_type !== "practice") return false
      return visibleTheoryMaterials.some(
        (theoryMaterial) => theoryMaterial.subject_id === entry.subject_id && theoryMaterial.week_number === entry.week_number
      )
    },
    [materialById, visibleTheoryMaterials]
  )
  const continueMaterialEntries = useMemo(
    () =>
      currentContinueMaterial
        ? entries.filter((entry) => entry.subject_day_material_id === currentContinueMaterial.id)
        : [],
    [currentContinueMaterial, entries]
  )
  const continueGroups = useMemo(
    () => buildContinueGroups(continueMaterialEntries),
    [continueMaterialEntries]
  )
  useEffect(() => {
    if (selectedPracticeMaterialId == null) return
    if (selectedContinueMaterial || selectedContinueMaterialEntries.length > 0) return
    setSelectedPracticeMaterialId(null)
  }, [selectedContinueMaterial, selectedContinueMaterialEntries.length, selectedPracticeMaterialId])
  const getVisibleMaterialsForMode = useCallback(
    (mode: ContinueMode) => (mode === "theory" ? visibleTheoryMaterials : visiblePracticeMaterials),
    [visiblePracticeMaterials, visibleTheoryMaterials]
  )
  const getCoverageForMode = useCallback(
    (mode: ContinueMode) => (mode === "theory" ? currentSubjectTheoryCoverage : currentSubjectPracticeCoverage),
    [currentSubjectPracticeCoverage, currentSubjectTheoryCoverage]
  )
  const getContinueModeLabel = useCallback((mode: ContinueMode) => (mode === "theory" ? "teoria" : "practica"), [])
  const getLocalContinueFeaturedEntry = useCallback(
    () =>
      entries.find(
        (entry) =>
          entry.subject_id === currentSubject?.id &&
          entry.week_number === dialogSelectedWeekNumber &&
          entry.is_featured
      ) ?? null,
    [currentSubject?.id, dialogSelectedWeekNumber, entries]
  )
  const weekAudioDays = useMemo(() => {
    const grouped = activeDayEntries.reduce<Record<string, SubjectDayEntry[]>>((accumulator, entry) => {
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
  }, [activeDayEntries])
  const isSubjectDayRefreshing = (isEntriesLoading || isMaterialsLoading) && hasResolvedSubjectDayData
  const shouldShowInitialSubjectDayLoading = (isEntriesLoading || isMaterialsLoading) && !hasResolvedSubjectDayData
  const buildLocalContinuePayload = useCallback((mode: ContinueMode = continueMode): ContinuePayload | null => {
    if (!currentSubject) return null

    const selectedMaterial = mode === "theory" ? selectedTheoryMaterial : selectedPracticeMaterial
    const availableMaterials = getVisibleMaterialsForMode(mode)
    const material =
      selectedMaterial ??
      getNextUncheckedMaterial(availableMaterials, {
        mode,
        subjectId: currentSubject.id,
        sessionDate: subjectDialogDateKey,
        weekNumber: dialogSelectedWeekNumber,
      })

    const previousFeaturedEntry =
      getLocalContinueFeaturedEntry() ??
      continuePayload?.previousFeaturedEntry ??
      null

    return {
      mode,
      material,
      previousFeaturedEntry,
    }
  }, [
    continueMode,
    continuePayload?.previousFeaturedEntry,
    currentSubject,
    dialogSelectedWeekNumber,
    getLocalContinueFeaturedEntry,
    getVisibleMaterialsForMode,
    selectedPracticeMaterial,
    selectedTheoryMaterial,
    subjectDialogDateKey,
  ])
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
  const renderMaterialManagerSection = (mode: ContinueMode) => {
    const isTheorySection = mode === "theory"
    const materialsForMode = isTheorySection ? theoryMaterials : practiceMaterials
    const coverageItems = getCoverageForMode(mode)
    const title = isTheorySection ? "Archivos teoricos" : "Practica"
    const description = isTheorySection
      ? null
      : "No busques exhaustividad: una dupla fuerte por subtema critico ya cuenta como cobertura minima util."
    const fileInputRef = isTheorySection ? theoryFileInputRef : practiceFileInputRef
    const emptyLabel = isWeeklyExercisesScope
      ? `Todavia no hay PDFs de ${getContinueModeLabel(mode)} para esta semana.`
      : `Todavia no hay PDFs de ${getContinueModeLabel(mode)} para este dia.`

    return (
      <section className="space-y-3 rounded-2xl border border-border bg-muted/40 p-3 sm:p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">{title}</p>
            {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
          </div>
          <div className="grid grid-cols-3 gap-2 sm:flex sm:flex-wrap">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                if (!currentSubject) return
                window.open(
                  buildMaterialDraftViewerHref({
                    subjectId: currentSubject.id,
                    subjectName: getSubjectDisplayName(currentSubject),
                    sessionDate: subjectDialogDateKey,
                    weekNumber: dialogSelectedWeekNumber,
                    weekdayIndex: subjectDialogDayIndex >= 0 ? subjectDialogDayIndex : 0,
                    materialType: mode,
                  }),
                  "_blank",
                  "noopener,noreferrer"
                )
              }}
              disabled={isUploadingMaterialType !== null || !currentSubject}
              className="h-10 border-border px-0 text-foreground"
              aria-label={`Abrir visor para fragmentar un PDF de ${getContinueModeLabel(mode)}`}
            >
              <ExternalLink className="h-4 w-4" />
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => fileInputRef.current?.click()}
              disabled={isUploadingMaterialType !== null}
              className="h-10 border-border px-0 text-foreground"
            >
              {isUploadingMaterialType === mode ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            </Button>
            <Button
              type="button"
              onClick={() => void openContinueModal(mode)}
              className="h-10 bg-primary text-primary-foreground"
            >
              Continuar
            </Button>
          </div>
        </div>

        <div className="space-y-2">
          {materialsForMode.length > 0 ? (
            materialsForMode.map((material) => (
              <div key={material.id} className="rounded-xl border border-border bg-card px-3 py-3">
                {"is_pending_upload" in material ? (
                  <div className="space-y-2">
                    <span className="inline-flex min-w-0 items-center gap-2 truncate text-sm text-muted-foreground">
                      <Checkbox checked={false} disabled />
                      <span className="truncate">{material.file_name}</span>
                    </span>
                    {isWeeklyExercisesScope ? (
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {getWeekdayLabel(material.session_date)} {material.session_date}
                      </span>
                    ) : null}
                    <span className="inline-flex items-center gap-2 text-xs text-muted-foreground">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      Subiendo...
                    </span>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div className="flex items-start justify-between gap-3">
                      {(() => {
                      const coverage = coverageItems.find((item) => item.id === material.id)
                      const coverageLabel =
                        coverage?.status === "cubierto_minimo"
                          ? "Cubierto minimo"
                          : coverage?.status === "tocado_sin_dupla"
                            ? "Tocado sin dupla"
                            : "Sin tocar"
                      const coverageClassName =
                        coverage?.status === "cubierto_minimo"
                          ? "border-emerald-300 bg-emerald-50 text-emerald-700"
                          : coverage?.status === "tocado_sin_dupla"
                            ? "border-amber-300 bg-amber-50 text-amber-700"
                            : "border-red-300 bg-red-50 text-red-700"

                      return (
                        <span className={`shrink-0 rounded-full border px-2 py-1 text-[11px] ${coverageClassName}`}>
                          {coverageLabel}
                        </span>
                      )
                    })()}
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={() => void deleteMaterial(material)}
                        disabled={isDeletingMaterialId === material.id}
                        className="h-7 w-7 shrink-0 rounded-full text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                        aria-label={`Borrar ${material.file_name}`}
                      >
                        {isDeletingMaterialId === material.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <X className="h-3.5 w-3.5" />}
                      </Button>
                    </div>

                    <div className="flex items-center gap-3">
                      <Checkbox
                        checked={material.is_checkup_done}
                        onCheckedChange={(checked) => void toggleMaterialCheckup(material, Boolean(checked))}
                      />
                      <a
                        href={buildMaterialViewerHref(material.id)}
                        className="min-w-0 flex-1 truncate text-sm text-foreground hover:underline"
                      >
                        {material.file_name}
                      </a>
                    </div>

                    <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => void openContinueModal(mode, material.id)}
                        className="h-9 border-border px-3 text-xs text-foreground"
                      >
                        Ver
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => void copyEntriesForMaterial(material.id)}
                        disabled={(practiceEntriesByMaterialId[material.id] ?? []).length === 0 || isCopyingEntries}
                        className="h-9 border-border px-3 text-xs text-foreground"
                      >
                        Copiar
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            ))
          ) : (
            <p className="rounded-xl border border-dashed border-border bg-card px-3 py-4 text-sm text-muted-foreground">
              {emptyLabel}
            </p>
          )}
        </div>
      </section>
    )
  }

  const handleReset = async () => {
    try {
      const scheduledSubjects = getDisplaySubjectsForDate(homeSelectedDate, showAllSubjectsForDay, visibleSubjects)
      const scheduledSubjectIds = scheduledSubjects.map((subject) => subject.id)
      
      // Reset local state
      setActiveSubjects(scheduledSubjects)
      setCompletedSubjects([])
      setAllCompletedSubjectIds([])
      setHistory([])
      setHistoryIndex(-1)

      // Delete today's session from database
      await saveDailySession({
        date: currentDateKey,
        activeSubjectIds: scheduledSubjectIds,
        completedSubjects: {},
        showAllSubjects: showAllSubjectsForDay,
      })
    } catch (error) {
      console.error("[v0] Failed to reset:", error)
    }
  }

  const handleShowAllSubjectsChange = (checked: boolean) => {
    setDialogShowAllSubjectsForDay(checked)

    if (!checked && isDialogOpen && practiceSectionView === "exercises") {
      const visibleDialogSubjectIds = getDisplaySubjectIdsForDate(dialogSelectedDate, false, visibleSubjectIds)
      if (currentSubject && !visibleDialogSubjectIds.includes(currentSubject.id)) {
        void closeSubjectDialog()
      }
    }
  }

  const renderSynthesisMaterialSection = (mode: ContinueMode) => {
    const isTheory = mode === "theory"
    const materialsForMode = isTheory ? synthesisTheoryMaterials : synthesisPracticeMaterials
    const queueForMode = isTheory ? synthesisTheoryQueue : synthesisPracticeQueue
    const sectionLabel = isTheory ? "Teoria" : "Practica"

    return (
      <section className="space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-base font-medium text-foreground">{sectionLabel}</p>
          <Button
            type="button"
            variant="ghost"
            onClick={() => handleStartSynthesisPlayback(mode)}
            disabled={queueForMode.length === 0}
            className="h-8 px-2 text-sm text-muted-foreground hover:text-foreground"
          >
            {isTheory ? "Reproducir teoria" : "Reproducir practica"}
          </Button>
          {currentSynthesisPlaybackItem && queueForMode.some((item) => item.entryId === currentSynthesisPlaybackItem.entryId) ? (
            <>
              <Button
                type="button"
                variant="ghost"
                onClick={handlePauseResumeSynthesisPlayback}
                className="h-8 px-2 text-sm text-muted-foreground hover:text-foreground"
              >
                {isSynthesisPlaybackActive ? <Pause className="mr-1 h-4 w-4" /> : <Play className="mr-1 h-4 w-4" />}
                {isSynthesisPlaybackActive ? "Pausar" : "Reanudar"}
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={handleSkipSynthesisPlayback}
                className="h-8 px-2 text-sm text-muted-foreground hover:text-foreground"
              >
                <ChevronRight className="mr-1 h-4 w-4" />
                Siguiente audio
              </Button>
            </>
          ) : null}
        </div>

        {materialsForMode.length > 0 ? (
          <div className="space-y-1">
            {materialsForMode.map((material) => {
              const materialQueue = queueForMode.filter((item) => item.materialId === material.id)
              const isActive = currentSynthesisPlaybackItem?.materialId === material.id

              return (
                <div key={material.id} className="flex flex-wrap items-center gap-2 text-[1.05rem] leading-8 text-foreground sm:text-[1.15rem]">
                  <span className={isActive ? "font-semibold text-emerald-700" : ""}>{material.file_name}</span>
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => void openSynthesisMaterial(material, mode)}
                    className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground"
                  >
                    Ver
                  </Button>
                  {materialQueue.length > 0 ? (
                    <span className="text-xs text-muted-foreground">{`${materialQueue.length} audio${materialQueue.length === 1 ? "" : "s"}`}</span>
                  ) : null}
                </div>
              )
            })}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">{`Todavia no hay archivos de ${sectionLabel.toLowerCase()} cargados para esta semana.`}</p>
        )}
      </section>
    )
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
  const editingPair = useMemo(() => {
    if (!editingEntry?.pair_id) return null
    const pairEntries = entries.filter((entry) => entry.pair_id === editingEntry.pair_id)
    const questionEntry = pairEntries.find((entry) => entry.pair_role === "question") ?? null
    const answerEntry = pairEntries.find((entry) => entry.pair_role === "answer") ?? null
    return questionEntry && answerEntry ? { questionEntry, answerEntry } : null
  }, [editingEntry, entries])

  if (isLoading) {
    return (
      <div className="flex min-h-screen flex-col bg-background text-foreground transition-colors duration-300">
        <header className="flex items-center border-b border-border bg-card/95 p-5 shadow-sm backdrop-blur">
          <div className="flex gap-2">
            <div className="h-10 w-10 rounded-full border border-border bg-muted" />
            <div className="h-10 w-10 rounded-full border border-border bg-muted" />
          </div>
        </header>
        <main className="flex flex-1 items-center justify-center px-8 py-12 sm:px-12">
          <div className="aspect-square w-full max-w-md animate-pulse rounded-full bg-muted" />
        </main>
        <footer className="border-t border-border bg-card px-4 py-4 text-center text-xs text-muted-foreground">
          Cargando...
        </footer>
      </div>
    )
  }

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground transition-colors duration-300">
      {/* Header */}
      <header className="border-b border-border bg-card/95 shadow-sm backdrop-blur">
        <div className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6 sm:py-5">
          <div className="order-2 flex min-h-5 items-center justify-center gap-1.5 px-1 text-xs text-muted-foreground sm:order-1 sm:min-w-[160px] sm:justify-start">
            {saveStatus === "saving" && (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                <span>Guardando...</span>
              </>
            )}
            {saveStatus === "saved" && (
              <>
                <Check className="h-3.5 w-3.5 text-green-500" />
                <span className="text-green-500">Guardado</span>
              </>
            )}
            {saveStatus === "error" && (
              <span className="text-center text-red-500">Error al guardar</span>
            )}
          </div>

          <div className="order-1 flex items-center justify-end gap-2 overflow-x-auto pb-1 sm:order-2 sm:gap-3 sm:pb-0 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            <Button
              onClick={openPracticeModal}
              variant="outline"
              size="icon"
              className="h-11 w-11 shrink-0 rounded-full border-border bg-background/70"
              aria-label="Practica"
              title="Practica"
            >
              <GraduationCap className="h-4 w-4" />
            </Button>
            <Button
              onClick={openReviewModal}
              variant="outline"
              size="icon"
              className="h-11 w-11 shrink-0 rounded-full border-border bg-background/70"
              aria-label="Destacado"
              title="Destacado"
            >
              <Sparkles className="h-4 w-4" />
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  size="icon"
                  className="h-11 w-11 shrink-0 rounded-full border-border bg-background/70"
                  aria-label="Cambiar tema"
                  title="Cambiar tema"
                >
                  <Palette className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" sideOffset={10} className="w-64 rounded-2xl border-border bg-popover">
                <DropdownMenuLabel>Tema</DropdownMenuLabel>
                <DropdownMenuSeparator />
                {APP_THEMES.map((themeOption) => {
                  const isActive = themeOption.id === currentAppTheme

                  return (
                    <DropdownMenuItem
                      key={themeOption.id}
                      onClick={() => setTheme(themeOption.id)}
                      className="flex items-center gap-3 rounded-xl px-3 py-3"
                    >
                      <span className={`h-8 w-8 shrink-0 rounded-full border border-white/40 bg-gradient-to-br ${themeOption.swatchClassName}`} />
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-medium">{themeOption.label}</span>
                        <span className="block text-xs text-muted-foreground">{themeOption.description}</span>
                      </span>
                      <span className={`h-2.5 w-2.5 rounded-full transition ${isActive ? "bg-primary" : "bg-transparent"}`} />
                    </DropdownMenuItem>
                  )
                })}
              </DropdownMenuContent>
            </DropdownMenu>
            <Button
              onClick={openSynthesisModal}
              variant="outline"
              size="icon"
              className="h-11 w-11 shrink-0 rounded-full border-border bg-background/70"
              aria-label="Sintesis"
              title="Sintesis"
            >
              <BarChart3 className="h-4 w-4" />
            </Button>
            <button
              onClick={handleReset}
              className="shrink-0 rounded-full border border-transparent p-2.5 text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
              aria-label="Reiniciar"
              title="Reiniciar todas las materias"
            >
              <RotateCcw className="h-5 w-5" />
            </button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex flex-1 items-center justify-center px-8 py-12 sm:px-12 sm:py-14">
        {activeSubjects.length > 0 ? (
          <svg viewBox="0 0 320 320" className="w-full max-w-[560px]">
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
                  fill={getSubjectVisualColor(subject)}
                  stroke={wheelStrokeColor}
                  strokeWidth="3"
                  className="transition-all duration-500 hover:brightness-110 active:brightness-90"
                />
                <text
                  x={labelX}
                  y={labelY}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  fill={wheelTextColor}
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
            <h2 className="mb-2 text-2xl font-bold text-foreground">¡Todo completado!</h2>
            <p className="text-muted-foreground">Todas las materias fueron vistas hoy</p>
          </div>
        )}
      </main>

      {/* Footer - Completed Subjects */}
      <footer className="border-t border-border bg-card px-4 py-4 text-center text-xs text-muted-foreground">
        {completedSubjects.length > 0 && (
          <div className="flex flex-wrap gap-2 justify-center mb-2">
            {completedSubjects.map((subject) => (
              <button
                key={subject.id}
                type="button"
                onClick={() => handleSubjectClick(subject)}
                className="px-3 py-1 rounded-full text-white text-xs font-medium transition-opacity hover:opacity-90"
                style={{ backgroundColor: getSubjectVisualColor(subject) }}
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

      {/* AI Modal */}
      <Dialog open={isAiOpen} onOpenChange={(open) => { if (!open) { setIsAiOpen(false); setAiSent(false); setAiResponse("") } }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-muted-foreground" />
              Consultar IA
            </DialogTitle>
            <DialogDescription>
              Escribe una consulta y usa como contexto el estado actual de las materias visibles.
            </DialogDescription>
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
                  <p className="text-xs text-muted-foreground">
                    Se enviará el panorama de las materias completadas como contexto.
                  </p>
                )}
              </>
            )}

            {/* Streaming response */}
            {aiSent && (
              <div
                ref={aiResponseRef}
                className="min-h-32 max-h-80 overflow-y-auto rounded-md border border-border bg-muted/40 p-3 text-sm text-foreground whitespace-pre-wrap leading-relaxed"
              >
                {isAiLoading && !aiResponse && (
                  <span className="flex items-center gap-2 text-muted-foreground">
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    Generando respuesta...
                  </span>
                )}
                {aiResponse}
                {isAiLoading && aiResponse && (
                  <span className="ml-0.5 inline-block h-4 w-1.5 animate-pulse bg-muted-foreground align-middle" />
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
                  className="bg-primary text-primary-foreground hover:bg-primary/90"
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

      <Dialog open={isSynthesisOpen} onOpenChange={(open) => (!open ? closeSynthesisModal() : undefined)}>
        <DialogContent
          showCloseButton={false}
          className="flex h-[100dvh] w-screen max-w-none flex-col overflow-hidden rounded-none border-0 p-0 text-foreground sm:max-w-none"
        >
          <DialogHeader className="border-b border-border bg-card px-6 py-3 text-left sm:px-8">
            <div className="flex items-center gap-4">
              <div className="flex min-w-0 flex-1 items-center gap-3 text-sm sm:text-base">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={handleSynthesisPreviousSubject}
                  className="h-8 min-w-8 px-0 text-muted-foreground hover:bg-transparent hover:text-foreground"
                >
                  {"<"}
                </Button>
                <p className="min-w-0 flex-1 text-left text-[1rem] font-medium text-foreground sm:text-[1.15rem]">
                  {synthesisHeaderLabel || "Sintesis"}
                </p>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={handleSynthesisNextSubject}
                  disabled={synthesisSubjectIndex < 0 || synthesisSubjectIndex >= synthesisSubjects.length - 1}
                  className="h-8 min-w-8 px-0 text-muted-foreground hover:bg-transparent hover:text-foreground disabled:opacity-35"
                >
                  {">"}
                </Button>
              </div>
              <button
                type="button"
                onClick={closeSynthesisModal}
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-border bg-card text-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
                aria-label="Cerrar sintesis"
                title="Cerrar"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto bg-muted/30 px-6 py-6 sm:px-8">
            <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
              <audio ref={synthesisPlaybackAudioRef} onEnded={handleSynthesisAudioEnded} className="hidden" />

              {isSynthesisLoading ? (
                <div className="flex min-h-40 items-center justify-center text-sm text-muted-foreground">
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Cargando sintesis...
                </div>
              ) : null}

              {!isSynthesisLoading ? (
                <>
                  {synthesisError ? (
                    <div className="text-sm text-red-700">
                      {synthesisError}
                    </div>
                  ) : null}

                  {synthesisSelectedSubject ? (
                    <section className="space-y-10 text-foreground">
                      {renderSynthesisMaterialSection("theory")}
                      {renderSynthesisMaterialSection("practice")}

                      <section className="space-y-4">
                        <p className="text-[1.95rem] font-semibold leading-tight text-foreground sm:text-[2.2rem]">
                          {`Son ${synthesisSelectedSummary?.exerciseTotalCount ?? 0} ejercicios, vas ${synthesisSelectedSummary?.exerciseSolvedCount ?? 0}/${synthesisSelectedSummary?.exerciseTotalCount ?? 0}`}
                        </p>

                        {synthesisExerciseMaterials.length > 0 ? (
                          <div className="space-y-3">
                            {synthesisExerciseMaterials.map((material) => {
                              const draft = synthesisSelectedState?.drafts[material.id] ?? createEmptySynthesisMaterialDraft()

                              return (
                                <div key={material.id} className="flex flex-col gap-2 text-[1.02rem] text-foreground sm:text-[1.1rem]">
                                  <div className="flex flex-wrap items-center gap-2">
                                    <span>{material.file_name}</span>
                                    <span aria-hidden="true">-&gt;</span>
                                    <input
                                      value={draft.exerciseScopeText}
                                      onChange={(event) => handleSynthesisDraftChange(material.id, "exerciseScopeText", event.target.value)}
                                      onBlur={handleSynthesisDraftCommit}
                                      onKeyDown={(event) => {
                                        if (event.key === "Enter") {
                                          event.preventDefault()
                                          ;(event.currentTarget as HTMLInputElement).blur()
                                        }
                                      }}
                                      placeholder="Ejercicios seleccionados..."
                                      className="min-w-[14rem] flex-1 border-b border-border bg-transparent px-1 py-0.5 text-foreground outline-none placeholder:text-muted-foreground"
                                    />
                                    <span>realice</span>
                                    <input
                                      value={draft.exerciseSolvedCount}
                                      onChange={(event) => handleSynthesisDraftChange(material.id, "exerciseSolvedCount", event.target.value)}
                                      onBlur={handleSynthesisDraftCommit}
                                      onKeyDown={(event) => {
                                        if (event.key === "Enter") {
                                          event.preventDefault()
                                          ;(event.currentTarget as HTMLInputElement).blur()
                                        }
                                      }}
                                      inputMode="numeric"
                                      className="w-16 border-b border-border bg-transparent px-1 py-0.5 text-center text-foreground outline-none"
                                    />
                                    <span>/</span>
                                    <input
                                      value={draft.exerciseTotalCount}
                                      onChange={(event) => handleSynthesisDraftChange(material.id, "exerciseTotalCount", event.target.value)}
                                      onBlur={handleSynthesisDraftCommit}
                                      onKeyDown={(event) => {
                                        if (event.key === "Enter") {
                                          event.preventDefault()
                                          ;(event.currentTarget as HTMLInputElement).blur()
                                        }
                                      }}
                                      inputMode="numeric"
                                      className="w-16 border-b border-border bg-transparent px-1 py-0.5 text-center text-foreground outline-none"
                                    />
                                  </div>
                                </div>
                              )
                            })}
                          </div>
                        ) : (
                          <p className="text-sm text-muted-foreground">No hay archivos de practica cargados para esta materia en esta semana.</p>
                        )}

                        {!hasSynthesisPerMaterialProgress && synthesisSelectedState?.legacySummary.exerciseSkippedText?.trim() ? (
                          <p className="text-sm text-muted-foreground">
                            {`Legado: saltaste ${synthesisSelectedState.legacySummary.exerciseSkippedText} por repetitivos.`}
                          </p>
                        ) : null}
                        {isSynthesisSaving ? <p className="text-sm text-muted-foreground">Guardando...</p> : null}
                      </section>
                    </section>
                  ) : null}
                </>
              ) : null}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={isSynthesisWeekSelectorOpen} onOpenChange={setIsSynthesisWeekSelectorOpen}>
        <DialogContent className="max-w-md border border-border bg-card text-foreground">
          <DialogHeader className="space-y-2 text-left">
            <DialogTitle>Seleccionar semana</DialogTitle>
            <DialogDescription>Al volver desde la primera materia, el recorrido de sintesis cambia de semana.</DialogDescription>
          </DialogHeader>

          <div className="grid gap-2">
            {synthesisWeekOptions.map((weekNumber) => (
              <Button
                key={weekNumber}
                type="button"
                variant={weekNumber === synthesisWeekNumber ? "default" : "outline"}
                onClick={() => handleSelectSynthesisWeek(weekNumber)}
                className="justify-start"
              >
                Semana {weekNumber}
              </Button>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={isNextWeekDialogOpen} onOpenChange={setIsNextWeekDialogOpen}>
        <DialogContent className="max-w-md border border-border bg-card text-foreground">
          <DialogHeader className="space-y-2 text-left">
            <DialogTitle>Comenzar siguiente semana</DialogTitle>
            <DialogDescription className="text-sm text-muted-foreground">
              Adelanta la vista a la proxima semana para cargar material antes del lunes cuando ya este habilitado.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="sm:justify-start">
            <Button
              type="button"
              onClick={() => void startNextWeek()}
              disabled={homeSelectedWeekNumber >= currentCalendarWeek + 1}
              className="bg-primary text-primary-foreground hover:bg-primary/90"
            >
              Comenzar semana {currentCalendarWeek + 1}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={isDialogOpen} onOpenChange={(open) => (!open ? void closeSubjectDialogOrReturn() : undefined)}>
        <DialogContent className="h-[100dvh] w-screen max-w-none border-0 bg-card p-0 shadow-none sm:h-[96vh] sm:w-[98vw] sm:max-w-[98vw] sm:border sm:border-border" showCloseButton={false}>
          <div className="relative flex h-full flex-col overflow-hidden px-3 py-3 sm:p-8">
            <Button
              variant="outline"
              size="icon"
              onClick={() => void (practiceSectionView === "exercises" && !subjectViewDateOverride ? moveWeek(-1) : moveDay(-1))}
              disabled={
                practiceSectionView === "exercises" && !subjectViewDateOverride
                  ? dialogSelectedWeekNumber <= 0
                  : subjectDialogDayIndex <= 0
              }
              className="absolute left-3 top-1/2 z-20 hidden h-10 w-10 -translate-y-1/2 rounded-full border border-border bg-card text-foreground opacity-70 hover:bg-accent hover:opacity-100 disabled:opacity-25 sm:flex sm:h-12 sm:w-12"
            >
              <ChevronLeft className="h-5 w-5" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              onClick={() => void (practiceSectionView === "exercises" && !subjectViewDateOverride ? moveWeek(1) : moveDay(1))}
              disabled={
                practiceSectionView === "exercises" && !subjectViewDateOverride
                  ? dialogSelectedWeekNumber >= latestWeekNumber
                  : subjectDialogDayIndex === -1 || subjectDialogDayIndex >= lastVisibleDayIndex
              }
              className="absolute right-3 top-1/2 z-20 hidden h-10 w-10 -translate-y-1/2 rounded-full border border-border bg-card text-foreground opacity-70 hover:bg-accent hover:opacity-100 disabled:opacity-25 sm:flex sm:h-12 sm:w-12"
            >
              <ChevronRight className="h-5 w-5" />
            </Button>

            <DialogHeader className="border-b border-border pb-3 sm:pb-4">
              <div className="space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <DialogTitle className="min-w-0 text-left text-[1.15rem] font-normal leading-tight text-foreground sm:text-[clamp(1.35rem,4.2vw,2rem)]">
                    {getSubjectDisplayName(currentSubject)}
                  </DialogTitle>
                  <button
                    type="button"
                    onClick={() => void closeSubjectDialogOrReturn()}
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-border bg-card text-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
                    aria-label="Cerrar modal"
                    title="Cerrar"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>

                <div className="flex items-center justify-between gap-2 sm:hidden">
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={() => void (practiceSectionView === "exercises" && !subjectViewDateOverride ? moveWeek(-1) : moveDay(-1))}
                    disabled={
                      practiceSectionView === "exercises" && !subjectViewDateOverride
                        ? dialogSelectedWeekNumber <= 0
                        : subjectDialogDayIndex <= 0
                    }
                    className="h-9 w-9 rounded-full border-border"
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <div className="min-w-0 flex-1 text-center text-xs text-muted-foreground">
                    {practiceSectionView === "exercises" && !subjectViewDateOverride
                      ? `Semana ${dialogSelectedWeekNumber}`
                      : getWeekdayLabel(subjectDialogDateKey)}
                  </div>
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={() => void (practiceSectionView === "exercises" && !subjectViewDateOverride ? moveWeek(1) : moveDay(1))}
                    disabled={
                      practiceSectionView === "exercises" && !subjectViewDateOverride
                        ? dialogSelectedWeekNumber >= latestWeekNumber
                        : subjectDialogDayIndex === -1 || subjectDialogDayIndex >= lastVisibleDayIndex
                    }
                    className="h-9 w-9 rounded-full border-border"
                  >
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  {practiceSectionView === "exercises" && currentSubject
                    ? ([
                        { key: "e_fich" as const, label: "E-Fich" },
                        { key: "figma" as const, label: "Figma" },
                      ]).map((shortcut) => {
                        const url = getShortcutUrl(subjectShortcuts, shortcut.key)
                        return (
                          <Button
                            key={shortcut.key}
                            type="button"
                            variant="outline"
                            onPointerDown={() => handleShortcutPointerDown(shortcut.key)}
                            onPointerUp={handleShortcutPointerUp}
                            onPointerLeave={handleShortcutPointerCancel}
                            onPointerCancel={handleShortcutPointerCancel}
                            onClick={() => handleShortcutClick(shortcut.key)}
                            disabled={isSavingShortcut || isSubjectShortcutsLoading}
                            className={`h-9 border-border px-3 text-xs sm:text-sm ${
                              url ? "text-foreground" : "text-muted-foreground"
                            }`}
                            aria-label={shortcut.label}
                            title={
                              isSubjectShortcutsLoading
                                ? `Cargando ${shortcut.label}`
                                : url
                                  ? shortcut.label
                                  : `Agregar ${shortcut.label}`
                            }
                          >
                            {shortcut.label}
                          </Button>
                        )
                      })
                    : null}
                  {practiceSectionView === "theory" ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      onClick={() => void copyEntriesForDay()}
                      disabled={entries.length === 0 || isCopyingEntries}
                      className="h-9 w-9 rounded-full border-border text-foreground"
                      aria-label="Copiar"
                      title="Copiar"
                    >
                      {isCopyingEntries ? <Loader2 className="h-4 w-4 animate-spin" /> : <Copy className="h-4 w-4" />}
                    </Button>
                  ) : null}
                  {practiceSectionView === "theory" ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      onClick={() => currentSubject && markSubjectAsCompleted(currentSubject)}
                      className="h-9 w-9 rounded-full border-border text-foreground"
                      aria-label="Terminar"
                      title="Terminar"
                    >
                      <Check className="h-4 w-4" />
                    </Button>
                  ) : null}
                </div>
              </div>
              <DialogDescription className="sr-only">
                {isTheoryContinueMode
                  ? "Gestiona la teoria semanal de la materia, abre PDFs, sube archivos y continua con audio dupla."
                  : "Gestiona la materia actual con sus audios, PDFs y navegacion semanal."}
              </DialogDescription>
            </DialogHeader>

            <div className="flex-1 overflow-y-auto py-4 sm:py-6 sm:pl-14 sm:pr-14">
              <input
                ref={theoryFileInputRef}
                type="file"
                accept="application/pdf"
                multiple
                className="hidden"
                onChange={(event) => {
                  const files = Array.from(event.target.files ?? [])
                  event.target.value = ""
                  void handleMaterialUpload("theory", files)
                }}
              />
              <input
                ref={practiceFileInputRef}
                type="file"
                accept="application/pdf"
                multiple
                className="hidden"
                onChange={(event) => {
                  const files = Array.from(event.target.files ?? [])
                  event.target.value = ""
                  void handleMaterialUpload("practice", files)
                }}
              />

              {entriesError ? (
                <div className="mb-3 border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">{entriesError}</div>
              ) : null}

              {isSubjectDayRefreshing ? (
                <div className="mb-3 flex items-center gap-2 text-xs text-muted-foreground">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Actualizando...
                </div>
              ) : null}

              {currentSubject ? (
                <section className="mb-4 rounded-2xl border border-border bg-muted/40 p-4">
                  <div className="flex justify-end">
                    <div
                      className={`rounded-full border px-3 py-1 text-xs ${getVectorDayTone(currentSubjectVectorSummary.currentDay, currentSubjectVectorSummary.hasVector)}`}
                    >
                      {getCurrentSubjectVectorBadgeLabel(currentSubjectVectorSummary)}
                    </div>
                  </div>
                </section>
              ) : null}

              {practiceSectionView === "theory" && !isTheoryContinueMode ? (
                <div className="mb-2" />
              ) : (
                <>
                <div className="mb-6 space-y-4">
                  {renderMaterialManagerSection("theory")}

                  {isTheoryContinueMode ? null : renderMaterialManagerSection("practice")}

                  {isTheoryContinueMode ? null : (
                  <section className="space-y-3 rounded-2xl border border-border bg-muted/40 p-4">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">Semana</p>
                      </div>
                    </div>

                    <div className="space-y-2">
                      {weekAudioDays.length > 0 ? (
                        weekAudioDays.map((day) => (
                          <div key={day.sessionDate} className="flex items-center justify-between gap-3 rounded-xl border border-border bg-card px-3 py-2">
                            <span className="min-w-0 flex-1 truncate text-sm text-foreground">
                              {getWeekdayLabel(day.sessionDate)}
                            </span>
                            <Button
                              type="button"
                              variant="outline"
                              onClick={() => void openWeekAudioDay(day.sessionDate)}
                              className="h-8 border-border px-3 text-xs text-foreground"
                            >
                              Ver
                            </Button>
                            <Button
                              type="button"
                              variant="outline"
                              onClick={() => void copyEntriesForSession(day.sessionDate)}
                              disabled={day.entries.length === 0 || isCopyingEntries}
                              className="h-8 border-border px-3 text-xs text-foreground"
                            >
                              Copiar
                            </Button>
                          </div>
                        ))
                      ) : (
                        <p className="rounded-xl border border-dashed border-border bg-card px-3 py-4 text-sm text-muted-foreground">
                          Todavia no hay audios cargados en esta semana.
                        </p>
                      )}
                    </div>
                  </section>
                  )}
                </div>
                </>
              )}

              {shouldShowInitialSubjectDayLoading ? (
                <div className="flex min-h-56 items-center justify-center">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : practiceSectionView === "theory" && theoryDayEntries.length > 0 ? (
                <div className="space-y-3 pb-24 sm:space-y-4 sm:pb-28">
                  {theoryDayEntries.map((entry) => {
                    const isRevealed = revealedAnswers[entry.id]
                    const isExpandedAudio = expandedAudioEntryId === entry.id
                    const audioSrc = audioSourceUrls[entry.id]
                    const isEditingTitle = editingTitleId === entry.id

                    return (
                      <article key={entry.id} className="relative rounded-2xl border border-border bg-card px-3 py-3 sm:px-4">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          onClick={() => void deleteEntry(entry)}
                          disabled={isDeletingEntryId === entry.id}
                          className="absolute right-1.5 top-1.5 h-6 w-6 rounded-full text-muted-foreground hover:bg-accent hover:text-accent-foreground"
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
                                <p className="text-xs font-medium text-foreground sm:text-sm">{getEntryDisplayTitle(entry)}</p>
                              {canMoveEntryToTheory(entry) ? (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => openMoveEntryDialog(entry)}
                                  className="h-8 border-border px-3 text-xs text-foreground"
                                >
                                  Llevar a teoria
                                </Button>
                              ) : null}
                              <Button size="icon" variant="ghost" onClick={() => startTitleEdit(entry)} className="h-8 w-8">
                                <Pencil className="h-4 w-4 text-muted-foreground" />
                              </Button>
                            </div>
                            )}
                            <div className="flex flex-wrap items-center gap-2">
                              {entry.external_links.map((link) => (
                                <Button key={link.id} type="button" variant="outline" className="h-8 border-border px-3 text-xs text-foreground" asChild>
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
                                className="h-8 w-8 border-border text-foreground"
                              >
                                <Plus className="h-4 w-4" />
                              </Button>
                            </div>
                            <p className="text-sm leading-6 text-foreground sm:text-base sm:leading-7">
                              {entryHasTranscript(entry) ? entry.transcript_text : "Sin texto. Solo audio cargado."}
                            </p>
                          </div>

                          {entryHasAudio(entry) ? (
                            <Button variant="outline" onClick={() => void togglePlayback(entry.id)} className="h-10 shrink-0 border-border px-3 text-foreground sm:px-4">
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
                            <p className="text-xs text-muted-foreground">
                              El audio se descarga una sola vez y luego queda en memoria mientras el modal siga abierto.
                            </p>
                          </div>
                        ) : null}

                        <div className="mt-4 border-t border-border pt-3">
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
                                className="block w-full rounded-xl border border-border bg-background px-3 py-2 text-left text-sm text-foreground"
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
                <div className="pb-24 sm:pb-28">
                  <div className="rounded-2xl border border-dashed border-border bg-card px-4 py-6 text-sm text-muted-foreground sm:px-5">
                    No hay contenido teórico visible para este día.
                  </div>
                </div>
              ) : (
                <div className="pb-24 sm:pb-28"></div>
              )}

              {recordingError ? (
                <div className="mt-3 pr-24 text-sm text-red-700">{recordingError}</div>
              ) : null}
              {isRecording ? (
                <div className="mt-3 pr-24 text-sm text-muted-foreground">Grabando...</div>
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
                      sessionDate: subjectDialogDateKey,
                      weekNumber: dialogSelectedWeekNumber,
                      weekdayIndex: subjectDialogDayIndex >= 0 ? subjectDialogDayIndex : 0,
                    }

                    void (isRecording ? stopRecording() : startRecording(target))
                  }}
                  className={`flex h-16 w-16 items-center justify-center rounded-full border border-border shadow-sm sm:h-20 sm:w-20 ${
                    isRecording ? "bg-red-500 text-white" : "bg-card text-foreground"
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
                      sessionDate: subjectDialogDateKey,
                      weekNumber: dialogSelectedWeekNumber,
                      weekdayIndex: subjectDialogDayIndex >= 0 ? subjectDialogDayIndex : 0,
                    })
                  }}
                  className="flex h-12 w-12 items-center justify-center rounded-full border border-border bg-card text-foreground shadow-sm sm:h-14 sm:w-14"
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
          <div className="relative min-h-full bg-background px-5 py-5 text-foreground sm:px-8 sm:py-6">
            <DialogHeader className="mb-6 border-b border-border pb-4">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <DialogTitle className="text-left text-[2rem] font-normal leading-none text-foreground sm:text-[2.5rem]">
                    {continueMode === "theory" ? "Continuar teoria" : "Continuar"}
                  </DialogTitle>
                  <DialogDescription className="sr-only">
                    {continueMode === "theory"
                      ? "Continua la teoria con el PDF actual, el audio destacado previo y el resumen de la materia."
                      : "Continua la practica con el PDF actual, el audio destacado previo y el resumen de teoria de la materia."}
                  </DialogDescription>
                </div>
                <DialogClose asChild>
                  <button
                    type="button"
                    className="flex h-14 w-14 items-center justify-center rounded-full border border-border text-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
                    aria-label="Cerrar modal"
                  >
                    <X className="h-7 w-7" />
                  </button>
                </DialogClose>
              </div>
            </DialogHeader>

            {continueError ? (
              <div className="mb-4 rounded-2xl border border-red-300/60 bg-red-500/10 px-4 py-3 text-base text-red-600">{continueError}</div>
            ) : null}

            {isContinueLoading ? (
              <div className="flex min-h-40 items-center justify-center">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <div className="space-y-8 pb-24">
                <section className="space-y-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                    {continuePayload?.previousFeaturedEntry ? (
                      <div className="w-full min-w-0 flex-1 overflow-hidden rounded-xl border border-border bg-card px-2 py-2">
                        <audio
                          key={continuePayload.previousFeaturedEntry.id}
                          controls
                          preload="none"
                          src={`/api/subject-day-entries/${continuePayload.previousFeaturedEntry.id}/audio`}
                          className="block w-full min-w-0"
                        />
                      </div>
                    ) : (
                      <div className="flex h-12 w-full items-center rounded-xl border border-dashed border-border px-4 text-base text-muted-foreground">
                        Sin audio previo
                      </div>
                    )}
                    <Button
                      type="button"
                      variant="outline"
                      className="h-12 border-border px-5 text-base text-foreground"
                      onClick={() => {
                        if (!currentSubject) return

                  const target: AudioUploadTarget = {
                    source: "continue-context",
                    subjectId: currentSubject.id,
                    subjectName: getSubjectDisplayName(currentSubject),
                    sessionDate: subjectDialogDateKey,
                    weekNumber: dialogSelectedWeekNumber,
                    weekdayIndex: subjectDialogDayIndex >= 0 ? subjectDialogDayIndex : 0,
                    materialId: null,
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
                      <p className="text-lg text-foreground">Archivo actual</p>
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => void copyContinueEntries()}
                        disabled={continueMaterialEntries.length === 0 || isCopyingEntries}
                        className="h-10 border-border px-3 text-foreground"
                      >
                        {isCopyingEntries ? <Loader2 className="h-4 w-4 animate-spin" /> : <Copy className="h-4 w-4" />}
                        Copiar dudas
                      </Button>
                    </div>
                    {currentContinueMaterial ? (
                      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-card px-4 py-3 text-lg text-foreground">
                        <Checkbox
                          checked={currentContinueMaterial.is_checkup_done}
                          onCheckedChange={(checked) => void toggleMaterialCheckup(currentContinueMaterial, Boolean(checked))}
                        />
                          <a
                            href={buildMaterialViewerHref(currentContinueMaterial.id)}
                            className="font-medium underline-offset-2 hover:underline"
                          >
                            {currentContinueMaterial.file_name}
                          </a>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          onClick={() => void deleteMaterial(currentContinueMaterial)}
                          disabled={isDeletingMaterialId === currentContinueMaterial.id}
                          className="ml-auto h-6 w-6 rounded-full text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                          aria-label={`Borrar ${currentContinueMaterial.file_name}`}
                        >
                          {isDeletingMaterialId === currentContinueMaterial.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <X className="h-3.5 w-3.5" />}
                        </Button>
                      </div>
                    ) : (
                      <p className="text-base text-muted-foreground">
                        {getVisibleMaterialsForMode(continueMode).length === 0
                          ? `No hay archivos de ${getContinueModeLabel(continueMode)} cargados.`
                          : `No se pudo resolver un PDF de ${getContinueModeLabel(continueMode)} para continuar.`}
                      </p>
                    )}
                  </div>

                  {continueGroups.length > 0 ? (
                    <div className="space-y-5">
                      {continueGroups.map((group, index) => {
                        if (group.kind === "pair") {
                          const titleEntry = group.titleEntry
                          const isEditingTitle = editingTitleId === titleEntry.id
                          const questionExpandedAudio = expandedAudioEntryId === group.questionEntry.id
                          const answerExpandedAudio = expandedAudioEntryId === group.answerEntry.id
                          const questionAudioSrc = audioSourceUrls[group.questionEntry.id]
                          const answerAudioSrc = audioSourceUrls[group.answerEntry.id]
                          const isDeletingGroup =
                            isDeletingEntryId === group.questionEntry.id || isDeletingEntryId === group.answerEntry.id

                          return (
                            <article key={group.pairId} className="relative space-y-5 border-t border-border pt-5">
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                onClick={() => void deleteEntry(group.questionEntry)}
                                disabled={isDeletingGroup}
                                className="absolute right-0 top-4 h-6 w-6 rounded-full text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                                aria-label={`Borrar ${getEntryDisplayTitle(titleEntry)}`}
                              >
                                {isDeletingGroup ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <X className="h-3.5 w-3.5" />}
                              </Button>

                              {isEditingTitle ? (
                                <div className="flex flex-wrap items-center gap-2">
                                  <Input
                                    value={titleDrafts[titleEntry.id] ?? ""}
                                    onChange={(event) =>
                                      setTitleDrafts((previous) => ({
                                        ...previous,
                                        [titleEntry.id]: event.target.value,
                                      }))
                                    }
                                    className="h-10 max-w-sm text-base"
                                  />
                                  <Button size="sm" onClick={() => void saveTitle(titleEntry)} disabled={isSavingTitleId === titleEntry.id}>
                                    {isSavingTitleId === titleEntry.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                                  </Button>
                                  <Button size="sm" variant="outline" onClick={() => setEditingTitleId(null)}>
                                    <X className="h-4 w-4" />
                                  </Button>
                                </div>
                              ) : (
                                <div className="flex flex-wrap items-center gap-2 pr-8 text-foreground">
                                  <p className="text-lg font-medium">{getEntryDisplayTitle(titleEntry)}</p>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() => void promoteEntryToSubjectAnchor(titleEntry)}
                                    className="h-8 border-border px-3 text-xs text-foreground"
                                  >
                                    Promover a ancla
                                  </Button>
                                  {continueMode === "practice" ? (
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      onClick={() => openMoveEntryDialog(titleEntry)}
                                      className="h-8 border-border px-3 text-xs text-foreground"
                                    >
                                      Llevar a teoria
                                    </Button>
                                  ) : null}
                                  <Button size="icon" variant="ghost" onClick={() => startTitleEdit(titleEntry)} className="h-8 w-8">
                                    <Pencil className="h-4 w-4" />
                                  </Button>
                                </div>
                              )}

                              <div className="space-y-3 rounded-xl border border-border bg-background px-4 py-4">
                                <p className="text-lg font-medium text-foreground">Pregunta:</p>
                                <div className="flex flex-wrap items-center gap-2">
                                  {entryHasAudio(group.questionEntry) ? (
                                    <Button variant="outline" onClick={() => void togglePlayback(group.questionEntry.id)} className="h-11 border-border px-4 text-base text-foreground">
                                      {loadingAudioEntryId === group.questionEntry.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                                      audio
                                    </Button>
                                  ) : null}
                                </div>
                                {entryHasAudio(group.questionEntry) && questionExpandedAudio && questionAudioSrc ? (
                                  <audio
                                    ref={(element) => {
                                      audioElementRefs.current[group.questionEntry.id] = element
                                    }}
                                    controls
                                    src={questionAudioSrc}
                                    preload="metadata"
                                    className="h-12 w-full"
                                  />
                                ) : null}
                                <p className="text-base leading-7 text-foreground">{group.questionEntry.transcript_text}</p>
                              </div>

                              <div className="space-y-3 rounded-xl border border-border bg-background px-4 py-4">
                                <p className="text-lg font-medium text-foreground">Respuesta:</p>
                                <div className="flex flex-wrap items-center gap-2">
                                  {entryHasAudio(group.answerEntry) ? (
                                    <Button variant="outline" onClick={() => void togglePlayback(group.answerEntry.id)} className="h-11 border-border px-4 text-base text-foreground">
                                      {loadingAudioEntryId === group.answerEntry.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                                      audio
                                    </Button>
                                  ) : null}
                                  <Button variant="outline" onClick={() => startAudioPairEdit(group.questionEntry)} className="h-11 border-border px-4 text-base text-foreground">
                                    Editar audio
                                  </Button>
                                  <Button variant="outline" onClick={() => startAnswerEdit(group.questionEntry)} className="h-11 border-border px-4 text-base text-foreground">
                                    Editar texto
                                  </Button>
                                </div>
                                {entryHasAudio(group.answerEntry) && answerExpandedAudio && answerAudioSrc ? (
                                  <audio
                                    ref={(element) => {
                                      audioElementRefs.current[group.answerEntry.id] = element
                                    }}
                                    controls
                                    src={answerAudioSrc}
                                    preload="metadata"
                                    className="h-12 w-full"
                                  />
                                ) : null}
                                <p className="text-base leading-7 text-foreground">{group.answerEntry.transcript_text}</p>
                              </div>
                            </article>
                          )
                        }

                        const entry = group.entry
                        const isExpandedAudio = expandedAudioEntryId === entry.id
                        const audioSrc = audioSourceUrls[entry.id]
                        const isEditingTitle = editingTitleId === entry.id
                        const isRevealed = revealedAnswers[entry.id]

                        return (
                          <article key={`single-${entry.id}-${index}`} className="relative space-y-3 border-t border-border pt-5">
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              onClick={() => void deleteEntry(entry)}
                              disabled={isDeletingEntryId === entry.id}
                              className="absolute right-0 top-4 h-6 w-6 rounded-full text-muted-foreground hover:bg-accent hover:text-accent-foreground"
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
                              <div className="flex flex-wrap items-center gap-2 pr-8 text-foreground">
                                <p className="text-lg font-medium">{getEntryDisplayTitle(entry)}</p>
                                {continueMode === "practice" ? (
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() => openMoveEntryDialog(entry)}
                                    className="h-8 border-border px-3 text-xs text-foreground"
                                  >
                                    Llevar a teoria
                                  </Button>
                                ) : null}
                                <Button size="icon" variant="ghost" onClick={() => startTitleEdit(entry)} className="h-8 w-8">
                                  <Pencil className="h-4 w-4" />
                                </Button>
                              </div>
                            )}

                            <p className="text-base leading-7 text-foreground">{entry.transcript_text}</p>

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
                              className="block w-full rounded-lg border border-border bg-background px-4 py-3 text-left text-base text-foreground"
                            >
                              {entry.answer_text
                                ? isRevealed
                                  ? entry.answer_text
                                  : "Click para revelar la respuesta"
                                : "Escribir respuesta"}
                            </button>

                            <div className="flex flex-wrap items-center gap-2">
                              {entry.pair_id ? (
                                <Button variant="outline" onClick={() => startAudioPairEdit(entry)} className="h-11 border-border px-4 text-base text-foreground">
                                  Completar dupla
                                </Button>
                              ) : null}
                              <Button variant="outline" onClick={() => startAnswerEdit(entry)} className="h-11 border-border px-4 text-base text-foreground">
                                {entry.pair_id ? "Editar texto" : "Responder"}
                              </Button>
                              {entryHasAudio(entry) ? (
                                <Button variant="outline" onClick={() => void togglePlayback(entry.id)} className="h-11 border-border px-4 text-base text-foreground">
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
                    <p className="text-base text-muted-foreground">Sin audios.</p>
                  ) : null}
                </section>
              </div>
            )}

            <div className="pointer-events-none absolute bottom-4 right-4">
              <div className="pointer-events-auto flex flex-col items-center gap-3">
                {!currentContinueMaterial ? (
                  <div className="max-w-xs rounded-2xl border border-amber-300/50 bg-amber-500/10 px-4 py-3 text-sm text-amber-700 shadow-sm">
                    No hay un PDF de practica activo para guardar audio o texto.
                  </div>
                ) : null}
                <button
                  type="button"
                  onClick={() => {
                    if (!currentSubject || !currentContinueMaterial) return

                    const target: AudioUploadTarget = {
                      source: "continue-practice",
                      subjectId: currentSubject.id,
                      subjectName: getSubjectDisplayName(currentSubject),
                      sessionDate: subjectDialogDateKey,
                      weekNumber: dialogSelectedWeekNumber,
                      weekdayIndex: subjectDialogDayIndex >= 0 ? subjectDialogDayIndex : 0,
                      materialId: currentContinueMaterial.id,
                    }

                    void (isRecording ? stopRecording() : startRecording(target))
                  }}
                  className="flex h-16 w-16 items-center justify-center rounded-full border border-border bg-card text-foreground shadow-sm"
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
                      weekNumber: dialogSelectedWeekNumber,
                      weekdayIndex: subjectDialogDayIndex >= 0 ? subjectDialogDayIndex : 0,
                      materialId: currentContinueMaterial.id,
                    })
                  }}
                  className="flex h-12 w-12 items-center justify-center rounded-full border border-border bg-card text-foreground shadow-sm"
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

      <Dialog open={Boolean(moveEntryTarget)} onOpenChange={(open) => (!open ? closeMoveEntryDialog() : undefined)}>
        <DialogContent showCloseButton={false} className="sm:max-w-lg">
          <DialogHeader>
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-2">
                <DialogTitle>Llevar duda a teoria</DialogTitle>
                <DialogDescription>
                  Mueve esta duda al PDF de teoria de la misma materia y semana.
                </DialogDescription>
              </div>
              <DialogClose asChild>
                <Button type="button" variant="ghost" size="icon" className="h-9 w-9 rounded-full" aria-label="Cerrar">
                  <X className="h-4 w-4" />
                </Button>
              </DialogClose>
            </div>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-1">
              <p className="text-sm font-medium text-foreground">Duda</p>
              <p className="text-sm text-muted-foreground">
                {moveEntryTarget ? getEntryDisplayTitle(moveEntryTarget) : ""}
              </p>
            </div>

            <div className="space-y-2">
              <p className="text-sm font-medium text-foreground">PDF de teoria destino</p>
              <Select value={moveEntryMaterialId} onValueChange={setMoveEntryMaterialId}>
                <SelectTrigger className="h-11 text-base">
                  <SelectValue placeholder="Selecciona un PDF de teoria" />
                </SelectTrigger>
                <SelectContent>
                  {moveEntryMaterialOptions.map((material) => (
                    <SelectItem key={material.id} value={String(material.id)}>
                      {`${getWeekdayLabel(material.session_date)} · ${material.file_name}`}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={closeMoveEntryDialog} disabled={isMovingEntryId !== null}>
              Cancelar
            </Button>
            <Button onClick={() => void moveEntryToTheoryMaterial()} disabled={!moveEntryMaterialId || isMovingEntryId !== null}>
              {isMovingEntryId !== null ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Mover
            </Button>
          </DialogFooter>
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
                  className="flex h-14 w-14 items-center justify-center rounded-full border border-border text-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
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
                <p className="text-sm font-medium text-foreground">Pregunta</p>
                <Textarea
                  value={
                    editingEntry
                      ? editingPair
                        ? (questionDrafts[editingPair.questionEntry.id] ?? editingPair.questionEntry.transcript_text)
                        : (questionDrafts[editingEntry.id] ?? editingEntry.transcript_text)
                      : manualQuestionDraft
                  }
                  onChange={(event) => {
                    if (editingEntry) {
                      setQuestionDrafts((previous) => ({
                        ...previous,
                        [editingPair?.questionEntry.id ?? editingEntry.id]: event.target.value,
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
                <p className="text-sm font-medium text-foreground">Respuesta</p>
                <Textarea
                  value={
                    editingEntry
                      ? editingPair
                        ? (answerDrafts[editingPair.answerEntry.id] ?? editingPair.answerEntry.transcript_text)
                        : (answerDrafts[editingEntry.id] ?? "")
                      : manualAnswerDraft
                  }
                  onChange={(event) => {
                    if (editingEntry) {
                      setAnswerDrafts((previous) => ({
                        ...previous,
                        [editingPair?.answerEntry.id ?? editingEntry.id]: event.target.value,
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

          <DialogFooter className="mt-4 border-t border-border pt-4">
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
                  className="flex h-14 w-14 items-center justify-center rounded-full border border-border text-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
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
              <p className="text-sm text-muted-foreground">
                {recordingTarget?.subjectName || getSubjectDisplayName(currentSubject)} - {recordingTarget ? getWeekdayLabel(recordingTarget.sessionDate) : getWeekdayLabel(subjectDialogDateKey)} - {recordingTarget?.sessionDate || subjectDialogDateKey}
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

      <Dialog open={Boolean(audioPairDraft)} onOpenChange={(open) => (!open ? cancelAudioPairReview() : undefined)}>
        <DialogContent
          showCloseButton={false}
          className="sm:max-w-2xl"
          onPointerDownOutside={(event) => event.preventDefault()}
          onInteractOutside={(event) => event.preventDefault()}
          onEscapeKeyDown={(event) => event.preventDefault()}
        >
          <DialogHeader>
            <div className="flex items-start justify-between gap-4">
              <div className="space-y-1">
                <DialogTitle>Confirmar dupla</DialogTitle>
                <DialogDescription className="sr-only">
                  Revisa la pregunta y la respuesta antes de confirmar o invertir el sentido de la dupla.
                </DialogDescription>
              </div>
              <DialogClose asChild>
                <button
                  type="button"
                  className="flex h-14 w-14 items-center justify-center rounded-full border border-border text-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
                  aria-label="Cerrar modal"
                >
                  <X className="h-7 w-7" />
                </button>
              </DialogClose>
            </div>
          </DialogHeader>

          {audioPairDraft ? (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-card/40 px-4 py-3">
                <p className="text-sm text-muted-foreground">Ajusta el sentido antes de confirmar.</p>
                <Button type="button" variant="outline" onClick={swapAudioPairDraftRoles} disabled={isUploadingAudio || isRecording}>
                  <RotateCcw className="h-4 w-4" />
                  Invertir roles
                </Button>
              </div>
              {(["question", "answer"] as const).map((role) => {
                const slot = audioPairDraft.slots[role]
                const isThisRecording = isRecording && audioPairRecordingRole === role
                return (
                  <div key={role} className="rounded-2xl border border-border bg-card/60 p-4">
                    <div className="mb-3 flex items-center justify-between gap-4">
                      <div>
                        <p className="text-lg font-medium text-foreground">{role === "question" ? "Pregunta" : "Respuesta"}</p>
                        <p className="text-sm text-muted-foreground">
                          {isThisRecording ? "Grabando..." : slot ? (slot.source === "persisted" && !slot.blob ? "Audio guardado" : "Audio listo") : "Sin audio"}
                        </p>
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => void startAudioPairSlotRecording(role)}
                        disabled={isUploadingAudio || isRecording}
                      >
                        <RotateCcw className="h-4 w-4" />
                        {slot ? "Regrabar" : "Grabar"}
                      </Button>
                    </div>

                    {slot ? (
                      <audio controls src={slot.url} className="w-full" />
                    ) : (
                      <div className="rounded-xl border border-dashed border-border px-4 py-3 text-sm text-muted-foreground">
                        Usa grabar para completar este audio.
                      </div>
                    )}
                  </div>
                )
              })}

              {recordingError ? <p className="text-sm text-red-600">{recordingError}</p> : null}

              <DialogFooter>
                {isRecording ? (
                  <Button variant="outline" onClick={stopRecording} disabled={isUploadingAudio}>
                    <Square className="h-4 w-4" />
                    Detener
                  </Button>
                ) : null}
                <Button variant="outline" onClick={cancelAudioPairReview} disabled={isUploadingAudio}>
                  Cancelar
                </Button>
                <Button
                  onClick={() => void confirmAudioPairReview()}
                  disabled={(!audioPairDraft.slots.question && !audioPairDraft.slots.answer) || isUploadingAudio || isRecording}
                >
                  {isUploadingAudio ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                  Confirmar
                </Button>
              </DialogFooter>
            </div>
          ) : null}
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
                  className="flex h-14 w-14 items-center justify-center rounded-full border border-border text-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
                  aria-label="Cerrar modal"
                >
                  <X className="h-7 w-7" />
                </button>
              </DialogClose>
            </div>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">Ingresa nombre</label>
              <Input
                value={linkDraft.label}
                onChange={(event) => setLinkDraft((previous) => ({ ...previous, label: event.target.value }))}
                placeholder="Apunte, video, PDF..."
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">Insertar link</label>
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

      <Dialog
        open={isShortcutDialogOpen}
        onOpenChange={(open) => {
          if (!open) {
            closeShortcutDialog()
          }
        }}
      >
        <DialogContent showCloseButton={false} className="sm:max-w-md">
          <DialogHeader>
            <div className="flex items-start justify-between gap-4">
              <div className="space-y-1">
                <DialogTitle>
                  {shortcutDialogMode === "edit" ? "Editar" : "Agregar"}{" "}
                  {shortcutDialogKey === "figma" ? "Figma" : "E-Fich"}
                </DialogTitle>
                <DialogDescription>
                  Este enlace queda guardado para toda la materia en el cursado.
                </DialogDescription>
              </div>
              <DialogClose asChild>
                <button
                  type="button"
                  className="flex h-14 w-14 items-center justify-center rounded-full border border-border text-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
                  aria-label="Cerrar modal"
                >
                  <X className="h-7 w-7" />
                </button>
              </DialogClose>
            </div>
          </DialogHeader>
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">Insertar link</label>
            <Input
              type="url"
              value={shortcutDraft}
              onChange={(event) => setShortcutDraft(event.target.value)}
              placeholder="https://..."
            />
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={closeShortcutDialog} disabled={isSavingShortcut}>
              Cancelar
            </Button>
            <Button onClick={() => void saveSubjectShortcut()} disabled={isSavingShortcut || !shortcutDraft.trim()}>
              {isSavingShortcut ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
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
          <DialogHeader className="border-b border-border bg-card px-6 py-5 sm:px-8">
            <div className="flex items-start justify-between gap-4">
              <div className="space-y-1">
                <DialogTitle>Repaso</DialogTitle>
                <DialogDescription>Selecciona una materia y entra directo a los dias con audio destacado.</DialogDescription>
              </div>
              <DialogClose asChild>
                <button
                  type="button"
                  className="flex h-14 w-14 items-center justify-center rounded-full border border-border text-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
                  aria-label="Cerrar modal"
                >
                  <X className="h-7 w-7" />
                </button>
              </DialogClose>
            </div>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto bg-muted/30 px-6 py-6 sm:px-8">
            {reviewSubjectId === "" ? (
              <div className="mx-auto flex h-full w-full max-w-4xl flex-col justify-center gap-8">
                <div className="space-y-2">
                  <p className="text-sm font-medium uppercase tracking-[0.24em] text-muted-foreground">Acceso rapido</p>
                  <h2 className="text-3xl font-semibold text-foreground sm:text-4xl">Elegi una materia</h2>
                </div>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {visibleSubjects.map((subject) => (
                    <button
                      key={subject.id}
                      type="button"
                      onClick={() => void loadReviewEntries(subject.id)}
                      className="rounded-3xl border border-border bg-card px-5 py-6 text-left shadow-sm transition hover:border-primary/40 hover:bg-accent"
                    >
                      <p className="text-base font-semibold text-foreground">{subject.name.replace("\n", " ")}</p>
                    </button>
                  ))}
                </div>
              </div>
            ) : isLoadingReview ? (
              <div className="flex h-full items-center justify-center py-10">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <p className="text-sm text-muted-foreground">Materia</p>
                    <h2 className="text-2xl font-semibold text-foreground">
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

                {reviewError ? <div className="rounded-2xl border border-red-300/60 bg-red-500/10 px-4 py-3 text-sm text-red-600">{reviewError}</div> : null}

                {Object.keys(reviewEntriesByWeek).length === 0 ? (
                  <div className="rounded-3xl border border-border bg-card px-6 py-10 text-center shadow-sm">
                    <p className="text-sm text-muted-foreground">No hay audios destacados para esta materia.</p>
                  </div>
                ) : (
                  Object.entries(reviewEntriesByWeek)
                    .sort(([leftWeek], [rightWeek]) => Number(leftWeek) - Number(rightWeek))
                    .map(([weekNumber, weekEntries]) => (
                      <section key={weekNumber} className="space-y-3">
                        <h3 className="text-lg font-semibold text-foreground">Semana {weekNumber}</h3>
                        <div className="space-y-3">
                          {weekEntries.map((entry) => (
                            <article key={entry.id} className="rounded-3xl border border-border bg-card px-4 py-4 shadow-sm">
                              <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                                <div className="min-w-0">
                                  <p className="text-sm font-medium text-muted-foreground">{getWeekdayLabel(entry.session_date)}</p>
                                  <p className="truncate text-lg font-semibold text-foreground">{getEntryDisplayTitle(entry)}</p>
                                </div>
                                <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                                  <audio controls preload="none" src={`/api/subject-day-entries/${entry.id}/audio`} className="sm:w-[320px]" />
                                  <Button
                                    type="button"
                                    variant="outline"
                                    onClick={() => void openSubjectDay(entry.subject_id, entry.session_date)}
                                    className="border-border text-foreground"
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
          <DialogHeader className="border-b border-border bg-card px-6 py-4 sm:px-8">
            <div className="flex items-center justify-between gap-4">
              <div className="min-w-0">
                {activePracticeShortcutSubject ? (
                  <DialogTitle className="truncate text-left text-[clamp(1.35rem,4.2vw,2rem)] font-normal leading-tight text-foreground">
                    {getSubjectDisplayName(activePracticeShortcutSubject)}
                  </DialogTitle>
                ) : (
                  <DialogTitle className="sr-only">Practicar</DialogTitle>
                )}
              </div>
              <div className="flex items-center gap-2">
                {activePracticeShortcutSubject
                  ? ([
                      { key: "e_fich" as const, label: "E-Fich" },
                      { key: "figma" as const, label: "Figma" },
                    ]).map((shortcut) => {
                      const url = getShortcutUrl(subjectShortcuts, shortcut.key)
                      return (
                        <Button
                          key={shortcut.key}
                          type="button"
                          variant="outline"
                          onPointerDown={() => handleShortcutPointerDown(shortcut.key)}
                          onPointerUp={handleShortcutPointerUp}
                          onPointerLeave={handleShortcutPointerCancel}
                          onPointerCancel={handleShortcutPointerCancel}
                          onClick={() => handleShortcutClick(shortcut.key)}
                          disabled={isSavingShortcut || isSubjectShortcutsLoading}
                          className={`h-9 border-border px-3 text-xs ${
                            url ? "text-foreground" : "text-muted-foreground"
                          }`}
                          aria-label={shortcut.label}
                          title={
                            isSubjectShortcutsLoading
                              ? `Cargando ${shortcut.label}`
                              : url
                                ? shortcut.label
                                : `Agregar ${shortcut.label}`
                          }
                        >
                          {shortcut.label}
                        </Button>
                      )
                    })
                  : null}
                <DialogClose asChild>
                  <button
                    type="button"
                    className="flex h-9 w-9 items-center justify-center rounded-full border border-border text-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
                    aria-label="Cerrar modal"
                    title="Cerrar"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </DialogClose>
              </div>
            </div>
          </DialogHeader>
          <div className="flex-1 overflow-y-auto bg-muted/30 px-6 py-6 sm:px-8">
            {(authSession.isAdmin || practiceLaunchView === "exercises") && (
              <div className="mx-auto mb-4 flex w-full max-w-5xl items-center justify-between gap-3">
                {practiceLaunchView === "exercises" ? (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Switch
                      checked={dialogShowAllSubjectsForDay}
                      onCheckedChange={handleShowAllSubjectsChange}
                      aria-label="Mostrar todas las materias del dia"
                      className="h-5 w-9 data-[state=checked]:bg-primary data-[state=unchecked]:bg-input"
                    />
                  </div>
                ) : (
                  <div />
                )}
                {authSession.isAdmin ? (
                  <Button
                    onClick={() => setIsAdminModalOpen(true)}
                    variant="outline"
                    className="h-9 border-border px-3 text-foreground"
                  >
                    Administrar
                  </Button>
                ) : null}
              </div>
            )}
            {/* Subject selection */}
            {practiceLaunchView === "theory" && practiceSubjectIndex === null && (
              <div className="mx-auto flex h-full w-full max-w-5xl flex-col justify-center gap-8">
                <div className="space-y-2">
                  <p className="text-sm font-medium uppercase tracking-[0.24em] text-muted-foreground">Modo practica</p>
                  <h2 className="text-3xl font-semibold text-foreground sm:text-4xl">
                    Elegi materia y como queres practicar
                  </h2>
                  <p className="max-w-2xl text-sm text-muted-foreground sm:text-base">
                    Se cargan todas las dudas de la semana elegida para la materia seleccionada.
                  </p>
                </div>
                <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                  <div className="space-y-3 rounded-3xl border border-border bg-card p-6 shadow-sm">
                    <p className="text-xs font-medium uppercase tracking-[0.22em] text-muted-foreground">Materia</p>
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
                  <div className="space-y-3 rounded-3xl border border-border bg-card p-6 shadow-sm">
                    <p className="text-xs font-medium uppercase tracking-[0.22em] text-muted-foreground">Semana</p>
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
                  <div className="space-y-3 rounded-3xl border border-border bg-card p-6 shadow-sm lg:col-span-2">
                    <p className="text-xs font-medium uppercase tracking-[0.22em] text-muted-foreground">Filtros</p>
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
                            ? "border-primary bg-primary/10 shadow-sm"
                            : "border-border bg-muted/50 hover:border-border hover:bg-card"
                        }`}
                      >
                        <Checkbox checked={practiceFilters.random} className="mt-0.5 pointer-events-none" />
                        <span className="space-y-1">
                          <span className="block text-sm font-semibold text-foreground">Aleatorio</span>
                          <span className="block text-xs text-muted-foreground">Mezcla el orden de las dudas cargadas.</span>
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
                            ? "border-amber-500 bg-amber-500/10 shadow-sm"
                            : "border-border bg-muted/50 hover:border-border hover:bg-card"
                        }`}
                      >
                        <Checkbox checked={practiceFilters.unanswered} className="mt-0.5 pointer-events-none" />
                        <span className="space-y-1">
                          <span className="block text-sm font-semibold text-foreground">Sin respuesta</span>
                          <span className="block text-xs text-muted-foreground">Solo dudas que aun no tienen respuesta.</span>
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
                            ? "border-rose-500 bg-rose-500/10 shadow-sm"
                            : "border-border bg-muted/50 hover:border-border hover:bg-card"
                        }`}
                      >
                        <Checkbox checked={practiceFilters.erre} className="mt-0.5 pointer-events-none" />
                        <span className="space-y-1">
                          <span className="block text-sm font-semibold text-foreground">Erre</span>
                          <span className="block text-xs text-muted-foreground">Solo dudas marcadas como erre.</span>
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
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {practiceDaySubjects.map((subject) => (
                    <button
                      key={subject.id}
                      type="button"
                      onClick={() => void openExercisesPracticeSubject(subject.id)}
                      className="rounded-3xl border border-border bg-card p-5 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-primary/40"
                    >
                      <p className="text-lg font-semibold text-foreground">{subject.name.replace("\n", " ")}</p>
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
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              </div>
            )}

            {/* No questions */}
            {practiceLaunchView === "theory" && practiceSubjectIndex !== null && !isLoadingPractice && practiceVisibleEntries.length === 0 && (
              <div className="mx-auto flex h-full w-full max-w-3xl items-center justify-center">
                <div className="w-full rounded-3xl border border-border bg-card px-6 py-10 text-center shadow-sm">
                  <p className="mb-4 text-sm text-muted-foreground sm:text-base">
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
                    <div className="flex flex-col gap-2 rounded-3xl border border-border bg-card px-5 py-4 shadow-sm sm:flex-row sm:items-center sm:justify-between">
                      <p className="text-sm text-muted-foreground">
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
                      <div className="w-full max-w-4xl rounded-[2rem] border border-border bg-card p-6 shadow-sm sm:p-8 lg:p-10">
                        <div className="space-y-8">
                          <div className="space-y-3">
                            <p className="text-xs font-medium uppercase tracking-[0.22em] text-muted-foreground">Pregunta</p>
                            <p className="text-sm font-medium text-muted-foreground">{getEntryDisplayTitle(currentPracticeEntry!)}</p>
                            <p className="text-xl font-semibold leading-relaxed text-foreground sm:text-2xl">
                              {currentPracticeEntry?.transcript_text}
                            </p>
                          </div>

                          <div className="rounded-3xl border border-dashed border-border bg-muted/40 p-5 sm:p-6">
                            <div className="flex items-start justify-between gap-3">
                              <div className="flex-1 space-y-3">
                                <p className="text-xs font-medium uppercase tracking-[0.22em] text-muted-foreground">Respuesta</p>
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
                                  className="cursor-pointer text-base leading-relaxed text-muted-foreground hover:text-foreground sm:text-lg"
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
                    <div className="w-full max-w-3xl rounded-[2rem] border border-border bg-card px-6 py-10 text-center shadow-sm">
                      <p className="mb-2 text-3xl font-semibold text-foreground">Terminaste</p>
                      <p className="mb-2 text-sm text-muted-foreground">
                        Cerralo un momento, respira hondo y afloja los hombros.
                      </p>
                      <p className="mb-6 text-sm text-muted-foreground">
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
