import {
  appendLocalSocraticReviewTurn,
  getLocalSocraticReviewSettings,
  saveLocalSocraticReviewSettings,
} from "@/lib/local-workspace-data"
import { requireOkJson } from "@/lib/client/api"
import { isLocalStorageMode } from "@/lib/storage-mode"
import { getSubjectById } from "@/lib/subjects"
import type {
  GroqModelOption,
  SocraticReviewGeneratedTurn,
  SocraticReviewQueuePayload,
  SocraticReviewSettings,
} from "@/lib/study-types"

export async function fetchSocraticReviewQueue(params: {
  subjectId: string
  weekNumber?: number | "current"
}) {
  if (isLocalStorageMode()) {
    const weekNumber = typeof params.weekNumber === "number" ? params.weekNumber : undefined
    const searchParams = new URLSearchParams({
      subjectId: params.subjectId,
      ...(weekNumber ? { weekNumber: String(weekNumber) } : {}),
    })
    const response = await fetch(`/api/subject-day-entries?${searchParams.toString()}`)
    const entries = await requireOkJson<any[]>(response, "No se pudo cargar la cola de repaso socratico.")
    const grouped = new Map<string, any[]>()
    for (const entry of entries) {
      if (!entry.pair_id) continue
      const bucket = grouped.get(entry.pair_id) ?? []
      bucket.push(entry)
      grouped.set(entry.pair_id, bucket)
    }

    const items = Array.from(grouped.entries())
      .map(([pairId, pairEntries]) => {
        const question = pairEntries.find((entry) => entry.pair_role === "question")
        const answer = pairEntries.find((entry) => entry.pair_role === "answer")
        if (!question || !answer) return null
        return {
          pairId,
          subjectId: question.subject_id,
          subjectName: getSubjectById(question.subject_id)?.name.replace("\n", " ") || question.subject_id,
          weekNumber: question.week_number,
          sessionDate: question.session_date,
          orderIndex: question.order_index,
          questionEntryId: question.id,
          questionTitle: question.display_title,
          questionTranscript: question.transcript_text,
          answerEntryId: answer.id,
          answerTitle: answer.display_title,
          answerTranscript: answer.transcript_text,
        }
      })
      .filter(Boolean)

    return {
      subjectId: params.subjectId,
      subjectName: getSubjectById(params.subjectId)?.name.replace("\n", " ") || params.subjectId,
      weekNumber: weekNumber ?? 0,
      items,
    } satisfies SocraticReviewQueuePayload
  }

  const searchParams = new URLSearchParams({
    subjectId: params.subjectId,
    weekNumber: String(params.weekNumber ?? "current"),
  })

  const response = await fetch(`/api/socratic-review/queue?${searchParams.toString()}`)
  return requireOkJson<SocraticReviewQueuePayload>(
    response,
    "No se pudo cargar la cola de repaso socratico."
  )
}

export async function fetchGroqModels() {
  if (isLocalStorageMode()) {
    return { models: [] as GroqModelOption[] }
  }

  const response = await fetch("/api/groq/models")
  return requireOkJson<{ models: GroqModelOption[] }>(
    response,
    "No se pudieron cargar los modelos de Groq."
  )
}

export async function fetchSocraticReviewSettings() {
  if (isLocalStorageMode()) {
    return getLocalSocraticReviewSettings()
  }

  const response = await fetch("/api/socratic-review/settings")
  return requireOkJson<SocraticReviewSettings>(
    response,
    "No se pudo cargar la configuracion socratica."
  )
}

export async function saveSocraticReviewSettings(selectedModel: string) {
  if (isLocalStorageMode()) {
    return saveLocalSocraticReviewSettings(selectedModel)
  }

  const response = await fetch("/api/socratic-review/settings", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ selectedModel }),
  })

  return requireOkJson<SocraticReviewSettings>(
    response,
    "No se pudo guardar la configuracion socratica."
  )
}

export async function generateSocraticReviewTurn(params: { pairId: string; modelId: string }) {
  if (isLocalStorageMode()) {
    const nextTurn = {
      turnId: Number(`${Date.now()}${Math.floor(Math.random() * 100).toString().padStart(2, "0")}`),
      pairId: params.pairId,
      subjectId: "",
      weekNumber: 0,
      answerEntryId: 0,
      questions: ["Explica la idea principal con tus palabras.", "Que detalle te haria dudar en un parcial?"],
      fallbackUsed: true,
      modelId: params.modelId,
    } satisfies SocraticReviewGeneratedTurn
    return appendLocalSocraticReviewTurn(nextTurn)
  }

  const response = await fetch("/api/socratic-review/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  })

  return requireOkJson<SocraticReviewGeneratedTurn>(
    response,
    "No se pudieron generar las preguntas socraticas."
  )
}

export async function revealSocraticReviewTurn(turnId: number) {
  if (isLocalStorageMode()) {
    void turnId
    return { ok: true as const }
  }

  const response = await fetch("/api/socratic-review/reveal", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ turnId }),
  })

  return requireOkJson<{ ok: true }>(
    response,
    "No se pudo registrar la revelacion de la respuesta."
  )
}
