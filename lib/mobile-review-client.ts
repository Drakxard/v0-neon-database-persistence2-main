import { requireOkJson } from "@/lib/client/api"
import type { VectorOverview } from "@/lib/study-types"

export async function fetchMobileReviewOverview(params: {
  weekNumber: number
  date: string
  includeInactive?: boolean
}) {
  const searchParams = new URLSearchParams({
    weekNumber: String(params.weekNumber),
    date: params.date,
    includeInactive: String(Boolean(params.includeInactive)),
  })
  const response = await fetch(`/api/mobile/review/overview?${searchParams.toString()}`)
  return requireOkJson<{ weekNumber: number; vectors: VectorOverview[] }>(
    response,
    "No se pudo cargar la cobertura semanal."
  )
}
