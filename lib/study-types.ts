export type SubjectDayEntryLink = {
  id: number
  label: string
  url: string
}

export type SubjectDayEntry = {
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
  pair_id: string | null
  pair_role: "question" | "answer" | null
  is_featured: boolean
  external_links: SubjectDayEntryLink[]
  created_at: string
  updated_at: string
}

export type SubjectDayMaterialType = "theory" | "practice"

export type SubjectDayMaterial = {
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

export type PendingSubjectDayMaterial = SubjectDayMaterial & {
  is_pending_upload: true
}

export type PracticeCoverageStatus = "sin_tocar" | "tocado_sin_dupla" | "cubierto_minimo"

export type VectorOverview = {
  subjectId: string
  subjectName: string
  weekNumber: number
  startDate: string | null
  currentDay: number | null
  endDate: string | null
  isActive: boolean
  relevantPracticeMaterialIds: number[]
  coveredPracticeMaterialIds: number[]
  totalPracticeMaterialIds: number[]
  staleReason: string[]
  severity: "green" | "yellow" | "red"
  stateLabel: string
  lastInteractionAt: string | null
  practiceMaterials: Array<{
    id: number
    fileName: string
    sessionDate: string
    status: PracticeCoverageStatus
    isCheckupDone: boolean
    pairCount: number
    entryCount: number
  }>
}

export type SubjectShortcutKey = "e_fich" | "figma"

export type SubjectShortcuts = {
  subjectId: string
  eFich: string | null
  figma: string | null
}

export type DailySessionRecord = {
  id?: number
  date: string
  active_subject_ids: string[]
  completed_subjects: Record<string, boolean>
  show_all_subjects: boolean
}

export type SubjectSynthesisRecord = {
  subjectId: string
  weekNumber: number
  exerciseSolvedCount: number
  exerciseTotalCount: number
  exerciseSkippedText: string | null
  updatedAt: string | null
}

export type SubjectMaterialSynthesisRecord = {
  subjectDayMaterialId: number
  exerciseScopeText: string
  exerciseSolvedCount: number
  exerciseTotalCount: number
  updatedAt: string | null
}

export type SubjectSynthesisDerivedSummary = {
  subjectId: string
  weekNumber: number
  hasPerMaterialProgress: boolean
  exerciseSolvedCount: number
  exerciseTotalCount: number
  percentage: number
  legacyExerciseSkippedText: string | null
}

export type SubjectSynthesisSubjectPayload = {
  subjectId: string
  weekNumber: number
  materials: SubjectDayMaterial[]
  entries: SubjectDayEntry[]
  legacySummary: SubjectSynthesisRecord
  materialProgress: SubjectMaterialSynthesisRecord[]
}

export type SocraticReviewQueueItem = {
  pairId: string
  subjectId: string
  subjectName: string
  weekNumber: number
  sessionDate: string
  orderIndex: number
  questionEntryId: number
  questionTitle: string
  questionTranscript: string
  answerEntryId: number
  answerTitle: string
  answerTranscript: string
}

export type SocraticReviewQueuePayload = {
  subjectId: string
  subjectName: string
  weekNumber: number
  items: SocraticReviewQueueItem[]
}

export type GroqModelOption = {
  id: string
  ownedBy: string
  label: string
}

export type SocraticReviewSettings = {
  selectedModel: string | null
}

export type SocraticReviewGeneratedTurn = {
  turnId: number
  pairId: string
  subjectId: string
  weekNumber: number
  answerEntryId: number
  questions: string[]
  fallbackUsed: boolean
  modelId: string | null
}
