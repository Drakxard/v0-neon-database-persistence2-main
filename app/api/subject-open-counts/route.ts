import { ensureSubjectAccess, requireAuthSession } from "@/lib/authz"
import { readLocalState, updateLocalState } from "@/lib/local-state-store"
import { parseOptionalNonNegativeInteger, parseRequiredString } from "@/lib/server/request-parsing"
import { normalizeAllowedSubjectIds } from "@/lib/subjects"

function buildLocalStateKey(weekNumber: number, subjectId: string) {
  return `${weekNumber}:${subjectId}`
}

function isValidHourKey(value: string) {
  return /^\d{4}-\d{2}-\d{2} \d{2}$/.test(value)
}

export async function GET(request: Request) {
  try {
    const auth = await requireAuthSession()
    if (auth.response) return auth.response

    const { searchParams } = new URL(request.url)
    const weekNumber = parseOptionalNonNegativeInteger(searchParams.get("weekNumber"))

    if (!Number.isInteger(weekNumber)) {
      return Response.json({ error: "Missing or invalid weekNumber" }, { status: 400 })
    }

    const state = await readLocalState()
    const allowedSubjectIds = auth.session!.allowedSubjectIds
    const filteredRows = Object.values(state.subjectOpenCounts)
      .filter((record) => {
        if (record.week_number !== weekNumber) return false
        return auth.session!.isAdmin || allowedSubjectIds.includes(record.subject_id)
      })
      .sort((left, right) => left.subject_id.localeCompare(right.subject_id))

    return Response.json(filteredRows)
  } catch (error) {
    console.error("[v0] GET /api/subject-open-counts error:", error)
    return Response.json({ error: "Failed to fetch subject open counts" }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const auth = await requireAuthSession()
    if (auth.response) return auth.response

    const body = await request.json()
    const subjectId = parseRequiredString(body?.subjectId)
    const hourKey = parseRequiredString(body?.hourKey)
    const weekNumber = parseOptionalNonNegativeInteger(body?.weekNumber)

    if (!subjectId || !Number.isInteger(weekNumber) || !isValidHourKey(hourKey)) {
      return Response.json({ error: "Invalid request data" }, { status: 400 })
    }

    const [normalizedSubjectId] = normalizeAllowedSubjectIds([subjectId])
    if (!normalizedSubjectId) {
      return Response.json({ error: "Invalid subject id" }, { status: 400 })
    }

    const forbidden = ensureSubjectAccess(auth.session!, normalizedSubjectId)
    if (forbidden) return forbidden

    const result = await updateLocalState((state) => {
      const key = buildLocalStateKey(weekNumber, normalizedSubjectId)
      const current = state.subjectOpenCounts[key]
      const now = new Date().toISOString()
      const shouldIncrement = current?.last_open_hour_key !== hourKey
      const next = {
        id: current?.id ?? Number(`${Date.now()}${Math.floor(Math.random() * 100).toString().padStart(2, "0")}`),
        week_number: weekNumber,
        subject_id: normalizedSubjectId,
        count: shouldIncrement ? (current?.count ?? 0) + 1 : (current?.count ?? 0),
        last_open_hour_key: shouldIncrement ? hourKey : (current?.last_open_hour_key ?? hourKey),
        created_at: current?.created_at ?? now,
        updated_at: now,
      }
      state.subjectOpenCounts[key] = next
      return next
    })

    return Response.json(result)
  } catch (error) {
    console.error("[v0] POST /api/subject-open-counts error:", error)
    return Response.json({ error: "Failed to save subject open count" }, { status: 500 })
  }
}
