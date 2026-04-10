import Groq from "groq-sdk"
import { neon } from "@neondatabase/serverless"

import { getSubjectById } from "@/lib/subjects"
import { getCurrentWeekNumber } from "@/lib/subject-utils"
import type {
  SocraticReviewGeneratedTurn,
  SocraticReviewQueueItem,
  SocraticReviewQueuePayload,
} from "@/lib/study-types"

const sql = neon(process.env.DATABASE_URL!)
const groqApiKey = process.env.GROQ_API_KEY || ""
const groq = groqApiKey ? new Groq({ apiKey: groqApiKey }) : null

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
    return value.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean)
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
  return trimmed.replace(/^[-*•\d.)\s]+/, "").trim()
}

function isValidQuestionList(value: unknown): value is string[] {
  if (!Array.isArray(value) || value.length !== 2) return false

  return value.every((item) => {
    if (typeof item !== "string") return false
    const normalized = item.trim()
    if (!normalized) return false
    return !/^[-*•]|\d+\./.test(normalized)
  })
}

function buildFallbackQuestions(answerTranscript: string) {
  const conceptSnippet = answerTranscript.replace(/\s+/g, " ").trim().slice(0, 140)

  return [
    `Si cambias uno de los supuestos centrales de esta conclusion sobre "${conceptSnippet}", ¿que parte de tu razonamiento deja de sostenerse y por que?`,
    `Si alguien defendiera la posicion contraria a "${conceptSnippet}", ¿como la refutarias sin repetir tu conclusion original?`,
  ]
}

async function listRecentBufferQuestions(pairId: string) {
  const rows = await sql`
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
  const rows = await sql`
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

  return rows.map(mapPairRow).filter((item) => hasUsableTranscript(item.questionTranscript) && hasUsableTranscript(item.answerTranscript))
}

async function getPairById(pairId: string) {
  const rows = await sql`
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
}) {
  if (!groq) {
    throw new Error("Missing GROQ_API_KEY")
  }

  const recentQuestionsText =
    params.recentQuestions.length > 0
      ? params.recentQuestions.map((question, index) => `${index + 1}. ${question}`).join("\n")
      : "Sin preguntas previas."

  const completionPromise = groq.chat.completions.create({
    model: process.env.GROQ_SOCRATIC_MODEL || "meta-llama/llama-4-scout-17b-16e-instruct",
    temperature: 0.2,
    max_completion_tokens: 350,
    messages: [
      {
        role: "system",
        content:
          "Eres un tutor socratico riguroso. Nunca ensenas contenido nuevo ni das la respuesta correcta. Solo formulas exactamente 2 preguntas abiertas, discursivas y desafiantes para tensionar la conclusion del alumno. No uses vietas, numeracion, saludos ni introducciones. Debes responder exclusivamente con JSON valido usando la forma {\"questions\":[\"...\",\"...\"]}.",
      },
      {
        role: "user",
        content: [
          `Materia: ${params.pair.subjectName}`,
          `Semana: ${params.pair.weekNumber}`,
          `Marco original: ${params.pair.questionTranscript}`,
          `Conclusion del alumno: ${params.pair.answerTranscript}`,
          `Preguntas recientes a evitar:`,
          recentQuestionsText,
          "Formula 2 preguntas estilo 'y si...' o 'pero si...' que obliguen a defender causalidad, limites o supuestos.",
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
  const questions = Array.isArray(parsed?.questions) ? parsed.questions.map((item: string) => sanitizeQuestion(item)) : []

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

export async function generateSocraticReviewTurn(pairId: string): Promise<SocraticReviewGeneratedTurn> {
  const pair = await getPairById(pairId)
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
    questions = await generateQuestionsWithGroq({ pair, recentQuestions })
    fallbackUsed = false
  } catch (error) {
    console.error("Socratic review generation failed, using fallback:", error)
  }

  const rows = await sql`
    INSERT INTO socratic_review_turns (
      pair_id,
      subject_id,
      week_number,
      question_entry_id,
      answer_entry_id,
      generated_questions_json,
      fallback_used
    ) VALUES (
      ${pair.pairId},
      ${pair.subjectId},
      ${pair.weekNumber},
      ${pair.questionEntryId},
      ${pair.answerEntryId},
      CAST(${JSON.stringify(questions)} AS JSONB),
      ${fallbackUsed}
    )
    RETURNING id, pair_id, subject_id, week_number, answer_entry_id, generated_questions_json, fallback_used
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
  }
}

export async function revealSocraticReviewTurn(turnId: number) {
  const rows = await sql`
    UPDATE socratic_review_turns
    SET revealed_at = COALESCE(revealed_at, NOW())
    WHERE id = ${turnId}
    RETURNING id, pair_id, subject_id, week_number, answer_entry_id, generated_questions_json, fallback_used
  ` as TurnRow[]

  return rows[0] ?? null
}

export async function getSocraticReviewTurn(turnId: number) {
  const rows = await sql`
    SELECT id, pair_id, subject_id, week_number, answer_entry_id, generated_questions_json, fallback_used
    FROM socratic_review_turns
    WHERE id = ${turnId}
    LIMIT 1
  ` as TurnRow[]

  return rows[0] ?? null
}

export function isMissingSocraticReviewTable(error: unknown) {
  return isMissingTable(error)
}
