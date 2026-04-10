import { requireOkJson } from "@/lib/client/api"
import type {
  SocraticReviewGeneratedTurn,
  SocraticReviewQueuePayload,
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

export async function generateSocraticReviewTurn(pairId: string) {
  const response = await fetch("/api/socratic-review/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pairId }),
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
