import { NextResponse } from "next/server"

import { requireAuthSession } from "@/lib/authz"
import { listSubjectSixDayVectors } from "@/lib/audio-coverage"
import { getWeekNumberForDate, parseDateKey } from "@/lib/subject-utils"
import { parseOptionalNonNegativeInteger, parseRequiredString } from "@/lib/server/request-parsing"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function badRequest(message: string) {
  return NextResponse.json({ error: message }, { status: 400 })
}

function parseSessionDate(sessionDate: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(sessionDate)) return null
  const parsed = parseDateKey(sessionDate)
  if (Number.isNaN(parsed.getTime())) return null
  return parsed
}

export async function GET(request: Request) {
  try {
    const auth = await requireAuthSession()
    if (auth.response) return auth.response

    const { searchParams } = new URL(request.url)
    const rawWeekNumber = parseOptionalNonNegativeInteger(searchParams.get("weekNumber"))
    const dateKey = parseRequiredString(searchParams.get("date"))
    const parsedDate = dateKey ? parseSessionDate(dateKey) : null

    if (dateKey && !parsedDate) {
      return badRequest("Invalid date")
    }

    const weekNumber =
      !Number.isNaN(rawWeekNumber) && rawWeekNumber >= 0
        ? rawWeekNumber
        : parsedDate
          ? getWeekNumberForDate(parsedDate)
          : getWeekNumberForDate(new Date())

    const includeInactive = searchParams.get("includeInactive") === "true"
    const subjectIds = auth.session?.isAdmin ? undefined : auth.session?.allowedSubjectIds ?? []
    const vectors = await listSubjectSixDayVectors({
      weekNumber,
      includeInactive,
      subjectIds,
      now: parsedDate ?? new Date(),
    })
    return NextResponse.json({ weekNumber, vectors })
  } catch (error) {
    console.error("GET /api/mobile/review/overview error:", error)
    return NextResponse.json({ error: "Failed to load audio coverage overview" }, { status: 500 })
  }
}
