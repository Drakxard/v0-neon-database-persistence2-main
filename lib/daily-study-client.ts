import { requireOkJson } from "@/lib/client/api"
import type { DailySessionRecord } from "@/lib/study-types"

export async function fetchDailySession(date: string, tabId = "main") {
  const response = await fetch(`/api/sessions?date=${encodeURIComponent(date)}&tabId=${encodeURIComponent(tabId)}`)
  return requireOkJson<DailySessionRecord | null>(response, "No se pudo cargar la sesion diaria.")
}

export async function saveDailySession(input: {
  date: string
  tabId?: string
  activeSubjectIds: string[]
  completedSubjects: Record<string, boolean>
  showAllSubjects: boolean
}) {
  const response = await fetch("/api/sessions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  })

  return requireOkJson<DailySessionRecord>(response, "No se pudo guardar la sesion diaria.")
}
