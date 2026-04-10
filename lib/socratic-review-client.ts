import { requireOkJson } from "@/lib/client/api"
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
  const response = await fetch("/api/groq/models")
  return requireOkJson<{ models: GroqModelOption[] }>(
    response,
    "No se pudieron cargar los modelos de Groq."
  )
}

export async function fetchSocraticReviewSettings() {
  const response = await fetch("/api/socratic-review/settings")
  return requireOkJson<SocraticReviewSettings>(
    response,
    "No se pudo cargar la configuracion socratica."
  )
}

export async function saveSocraticReviewSettings(selectedModel: string) {
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
