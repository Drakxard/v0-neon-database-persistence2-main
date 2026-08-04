import { getLegacyDatabase } from "@/lib/db"
import { requireSql } from "@/lib/db"

import { listGroqGenerationModels, requireGroqClient, validateGroqModelId } from "@/lib/groq-models"
import { getSubjectById } from "@/lib/subjects"
import { getCurrentWeekNumber } from "@/lib/subject-utils"
import type {
  SocraticReviewGeneratedTurn,
  SocraticReviewQueueItem,
  SocraticReviewQueuePayload,
  SocraticReviewSettings,
} from "@/lib/study-types"

const sql = getLegacyDatabase()

type PairRow = {
  pair_id: string
  subject_id: string
  week_number: number
  session_date: string | Date
  order_index: number
  question_entry_id: number
  question_custom_title: string | null
  question_transcript: string
  answer_entry_id: number
  answer_custom_title: string | null
  answer_transcript: string
}

type TurnRow = {
  id: number
  pair_id: string
  subject_id: string
  week_number: number
  answer_entry_id: number
  generated_questions_json: unknown
  fallback_used: boolean
  model_id: string | null
}

function normalizeSessionDateKey(value: string | Date) {
  if (value instanceof Date) {
    return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`
  }

  return value.includes("T") ? value.slice(0, 10) : value
}

function isMissingTable(error: unknown) {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "42P01")
}

function isMissingColumn(error: unknown) {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "42703")
}

function normalizeEntryTitle(value: string | null, fallback: string) {
  const trimmed = String(value || "").trim()
  return trimmed || fallback
}

function hasUsableTranscript(value: string) {
  const normalized = String(value || "").trim().toLowerCase()
  return normalized.length > 0 && !normalized.startsWith("transcripcion pendiente")
}

function stripJsonFence(value: string) {
  const trimmed = value.trim()
  if (!trimmed.startsWith("```")) return trimmed

  return trimmed
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim()
}

function normalizeStoredQuestions(value: unknown) {
  if (Array.isArray(value)) {
    return value
      .filter((item): item is string => typeof item === "string")
      .map((item) => item.trim())
      .filter(Boolean)
  }

  if (value && typeof value === "object" && "questions" in value) {
    return normalizeStoredQuestions((value as { questions?: unknown }).questions)
  }

  if (typeof value === "string") {
    try {
      return normalizeStoredQuestions(JSON.parse(value))
    } catch {
      return []
    }
  }

  return []
}

function sanitizeQuestion(value: string) {
  const trimmed = value.trim().replace(/\s+/g, " ")
  return trimmed.replace(/^[-*\d.)\s]+/, "").trim()
}

function isValidQuestionList(value: unknown): value is string[] {
  if (!Array.isArray(value) || value.length !== 2) return false

  return value.every((item) => {
    if (typeof item !== "string") return false
    const normalized = item.trim()
    if (!normalized) return false
    return !/^[-*]|\d+\./.test(normalized)
  })
}

function buildFallbackQuestions(answerTranscript: string) {
  const conceptSnippet = answerTranscript.replace(/\s+/g, " ").trim().slice(0, 140)

  return [
    `Si cambias uno de los supuestos centrales de esta conclusion sobre "${conceptSnippet}", que parte de tu razonamiento deja de sostenerse y por que?`,
    `Si alguien defendiera la posicion contraria a "${conceptSnippet}", como la refutarias sin repetir tu conclusion original?`,
  ]
}

async function listRecentBufferQuestions(pairId: string) {
  const rows = await requireSql(sql)`
    SELECT generated_questions_json
    FROM socratic_review_turns
    WHERE pair_id = ${pairId}
    ORDER BY created_at DESC, id DESC
    LIMIT 6
  ` as Array<{ generated_questions_json: unknown }>

  return rows.flatMap((row) => normalizeStoredQuestions(row.generated_questions_json))
}

function mapPairRow(row: PairRow): SocraticReviewQueueItem {
  const subject = getSubjectById(row.subject_id)
  const questionTitle = normalizeEntryTitle(row.question_custom_title, `Duda ${Number(row.order_index) + 1}`)
  const answerTitle = normalizeEntryTitle(row.answer_custom_title, "Respuesta")

  return {
    pairId: row.pair_id,
    subjectId: row.subject_id,
    subjectName: subject?.name.replace(/\n/g, " ") || row.subject_id,
    weekNumber: Number(row.week_number),
    sessionDate: normalizeSessionDateKey(row.session_date),
    orderIndex: Number(row.order_index),
    questionEntryId: Number(row.question_entry_id),
    questionTitle,
    questionTranscript: row.question_transcript.trim(),
    answerEntryId: Number(row.answer_entry_id),
    answerTitle,
    answerTranscript: row.answer_transcript.trim(),
  }
}

async function selectEligiblePairs(subjectId: string, weekNumber: number) {
  const rows = await requireSql(sql)`
    SELECT
      question.pair_id,
      question.subject_id,
      question.week_number,
      question.session_date,
      question.order_index,
      question.id AS question_entry_id,
      question.custom_title AS question_custom_title,
      question.transcript_text AS question_transcript,
      answer.id AS answer_entry_id,
      answer.custom_title AS answer_custom_title,
      answer.transcript_text AS answer_transcript
    FROM subject_day_entries AS question
    INNER JOIN subject_day_entries AS answer
      ON answer.pair_id = question.pair_id
    WHERE question.subject_id = ${subjectId}
      AND question.week_number = ${weekNumber}
      AND question.pair_id IS NOT NULL
      AND question.pair_role = 'question'
      AND answer.pair_role = 'answer'
      AND answer.subject_id = question.subject_id
      AND answer.week_number = question.week_number
      AND answer.session_date = question.session_date
      AND COALESCE(question.drive_file_id, '') <> ''
      AND COALESCE(answer.drive_file_id, '') <> ''
      AND question.drive_mime_type LIKE 'audio/%'
      AND answer.drive_mime_type LIKE 'audio/%'
      AND BTRIM(COALESCE(question.transcript_text, '')) <> ''
      AND BTRIM(COALESCE(answer.transcript_text, '')) <> ''
      AND LOWER(BTRIM(COALESCE(question.transcript_text, ''))) NOT LIKE 'transcripcion pendiente%'
      AND LOWER(BTRIM(COALESCE(answer.transcript_text, ''))) NOT LIKE 'transcripcion pendiente%'
    ORDER BY question.session_date ASC, question.order_index ASC, question.id ASC
  ` as PairRow[]

  return rows
    .map(mapPairRow)
    .filter((item) => hasUsableTranscript(item.questionTranscript) && hasUsableTranscript(item.answerTranscript))
}

async function getPairById(pairId: string) {
  const rows = await requireSql(sql)`
    SELECT
      question.pair_id,
      question.subject_id,
      question.week_number,
      question.session_date,
      question.order_index,
      question.id AS question_entry_id,
      question.custom_title AS question_custom_title,
      question.transcript_text AS question_transcript,
      answer.id AS answer_entry_id,
      answer.custom_title AS answer_custom_title,
      answer.transcript_text AS answer_transcript
    FROM subject_day_entries AS question
    INNER JOIN subject_day_entries AS answer
      ON answer.pair_id = question.pair_id
    WHERE question.pair_id = ${pairId}
      AND question.pair_role = 'question'
      AND answer.pair_role = 'answer'
      AND answer.subject_id = question.subject_id
      AND answer.week_number = question.week_number
      AND answer.session_date = question.session_date
    LIMIT 1
  ` as PairRow[]

  return rows[0] ? mapPairRow(rows[0]) : null
}

export async function getSocraticReviewPair(pairId: string) {
  return getPairById(pairId)
}

async function generateQuestionsWithGroq(params: {
  pair: SocraticReviewQueueItem
  recentQuestions: string[]
  modelId: string
}) {
  const groq = requireGroqClient()
  const recentQuestionsText =
    params.recentQuestions.length > 0
      ? params.recentQuestions.map((question, index) => `${index + 1}. ${question}`).join("\n")
      : "Sin preguntas previas."

  const contextualText = [
    `Pregunta original: ${params.pair.questionTranscript}`,
    `Respuesta o conclusion del alumno: ${params.pair.answerTranscript}`,
  ].join("\n")

  const completionPromise = groq.chat.completions.create({
    model: params.modelId,
    temperature: 0.2,
    max_completion_tokens: 350,
    messages: [
      {
        role: "system",
        content:
          "Eres un tutor socratico riguroso. Nunca enseñas contenido nuevo ni das respuestas correctas. Analizas solo la dupla actual del alumno. Tu tarea es tensar la conclusion del alumno con exactamente 2 preguntas nuevas, abiertas y discursivas. Revisa el historial reciente para no repetir angulos. No uses viñetas, numeracion, saludos ni introducciones. Responde exclusivamente con JSON valido usando la forma {\"questions\":[\"...\",\"...\"]}.",
      },
      {
        role: "user",
        content: [
          `Materia: ${params.pair.subjectName}`,
          `Semana: ${params.pair.weekNumber}`,
          "[Contextual_Text]",
          contextualText,
          "[Dialogue_Buffer]",
          recentQuestionsText,
          "Formula exactamente 2 preguntas nuevas estilo 'y si...' o 'pero si...' que obliguen a defender causalidad, limites o supuestos sin poder responderse con si/no.",
        ].join("\n\n"),
      },
    ],
  })

  const completion = await Promise.race([
    completionPromise,
    new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error("LLM_TIMEOUT")), 4000)
    }),
  ])

  const rawContent = completion.choices[0]?.message?.content as unknown
  const normalizedContent =
    typeof rawContent === "string"
      ? rawContent
      : Array.isArray(rawContent)
        ? rawContent
            .map((item: unknown) => {
              if (!item || typeof item !== "object" || !("text" in item)) return ""
              return typeof item.text === "string" ? item.text : ""
            })
            .join("")
        : ""

  const parsed = JSON.parse(stripJsonFence(normalizedContent))
  const questions = Array.isArray(parsed?.questions)
    ? parsed.questions.map((item: string) => sanitizeQuestion(item))
    : []

  if (!isValidQuestionList(questions)) {
    throw new Error("INVALID_QUESTION_LIST")
  }

  return questions
}

export async function getSocraticReviewQueue(params: {
  subjectId: string
  weekNumber?: number
}): Promise<SocraticReviewQueuePayload> {
  const weekNumber = Number.isInteger(params.weekNumber) ? Number(params.weekNumber) : getCurrentWeekNumber()
  const subject = getSubjectById(params.subjectId)
  const items = await selectEligiblePairs(params.subjectId, weekNumber)

  return {
    subjectId: params.subjectId,
    subjectName: subject?.name.replace(/\n/g, " ") || params.subjectId,
    weekNumber,
    items,
  }
}

export async function generateSocraticReviewTurn(params: {
  pairId: string
  modelId: string
}): Promise<SocraticReviewGeneratedTurn> {
  const normalizedModelId = String(params.modelId || "").trim()
  if (!normalizedModelId) {
    throw new Error("MODEL_ID_REQUIRED")
  }

  const validatedModel = await validateGroqModelId(normalizedModelId)
  if (!validatedModel) {
    throw new Error("MODEL_ID_INVALID")
  }

  const pair = await getPairById(params.pairId)
  if (!pair) {
    throw new Error("PAIR_NOT_FOUND")
  }

  if (!hasUsableTranscript(pair.questionTranscript) || !hasUsableTranscript(pair.answerTranscript)) {
    throw new Error("PAIR_NOT_ELIGIBLE")
  }

  let questions = buildFallbackQuestions(pair.answerTranscript)
  let fallbackUsed = true

  try {
    const recentQuestions = await listRecentBufferQuestions(pair.pairId)
    questions = await generateQuestionsWithGroq({
      pair,
      recentQuestions,
      modelId: validatedModel.id,
    })
    fallbackUsed = false
  } catch (error) {
    console.error("Socratic review generation failed, using fallback:", error)
  }

  const rows = await requireSql(sql)`
    INSERT INTO socratic_review_turns (
      pair_id,
      subject_id,
      week_number,
      question_entry_id,
      answer_entry_id,
      generated_questions_json,
      fallback_used,
      model_id
    ) VALUES (
      ${pair.pairId},
      ${pair.subjectId},
      ${pair.weekNumber},
      ${pair.questionEntryId},
      ${pair.answerEntryId},
      CAST(${JSON.stringify(questions)} AS JSONB),
      ${fallbackUsed},
      ${validatedModel.id}
    )
    RETURNING id, pair_id, subject_id, week_number, answer_entry_id, generated_questions_json, fallback_used, model_id
  ` as TurnRow[]

  const row = rows[0]
  return {
    turnId: Number(row.id),
    pairId: row.pair_id,
    subjectId: row.subject_id,
    weekNumber: Number(row.week_number),
    answerEntryId: Number(row.answer_entry_id),
    questions: normalizeStoredQuestions(row.generated_questions_json),
    fallbackUsed: Boolean(row.fallback_used),
    modelId: row.model_id ?? null,
  }
}

export async function revealSocraticReviewTurn(turnId: number) {
  const rows = await requireSql(sql)`
    UPDATE socratic_review_turns
    SET revealed_at = COALESCE(revealed_at, NOW())
    WHERE id = ${turnId}
    RETURNING id, pair_id, subject_id, week_number, answer_entry_id, generated_questions_json, fallback_used, model_id
  ` as TurnRow[]

  return rows[0] ?? null
}

export async function getSocraticReviewTurn(turnId: number) {
  const rows = await requireSql(sql)`
    SELECT id, pair_id, subject_id, week_number, answer_entry_id, generated_questions_json, fallback_used, model_id
    FROM socratic_review_turns
    WHERE id = ${turnId}
    LIMIT 1
  ` as TurnRow[]

  return rows[0] ?? null
}

export async function getSocraticReviewSettings(email: string): Promise<SocraticReviewSettings> {
  const normalizedEmail = String(email || "").trim().toLowerCase()
  if (!normalizedEmail) {
    return { selectedModel: null }
  }

  const rows = await requireSql(sql)`
    SELECT selected_model
    FROM user_socratic_review_settings
    WHERE email = ${normalizedEmail}
    LIMIT 1
  ` as Array<{ selected_model: string | null }>

  return {
    selectedModel: rows[0]?.selected_model?.trim() || null,
  }
}

export async function updateSocraticReviewSettings(params: {
  email: string
  selectedModel: string
}): Promise<SocraticReviewSettings> {
  const normalizedEmail = String(params.email || "").trim().toLowerCase()
  const normalizedModelId = String(params.selectedModel || "").trim()

  if (!normalizedEmail) {
    throw new Error("SETTINGS_EMAIL_REQUIRED")
  }
  if (!normalizedModelId) {
    throw new Error("MODEL_ID_REQUIRED")
  }

  const validatedModel = await validateGroqModelId(normalizedModelId)
  if (!validatedModel) {
    throw new Error("MODEL_ID_INVALID")
  }

  const rows = await requireSql(sql)`
    INSERT INTO user_socratic_review_settings (
      email,
      selected_model
    ) VALUES (
      ${normalizedEmail},
      ${validatedModel.id}
    )
    ON CONFLICT (email)
    DO UPDATE SET
      selected_model = EXCLUDED.selected_model,
      updated_at = NOW()
    RETURNING selected_model
  ` as Array<{ selected_model: string | null }>

  return {
    selectedModel: rows[0]?.selected_model?.trim() || null,
  }
}

export async function listSocraticReviewModels() {
  return listGroqGenerationModels()
}

export function isMissingSocraticReviewTable(error: unknown) {
  return isMissingTable(error) || isMissingColumn(error)
}
