import { NextResponse } from "next/server"
import { getWeekNumberForDate, parseDateKey } from "@/lib/subject-utils"
import { ensureSubjectAccess, requireAuthSession } from "@/lib/authz"
import { listSubjectDayMaterials, reconcileSubjectDayMaterialsFromR2 } from "@/lib/subject-day-materials-r2"

export const runtime = "nodejs"

function isMissingSubjectDayMaterialsTable(error: unknown) {
  return Boolean(
    error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "42P01"
  )
}

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
    const subjectId = searchParams.get("subjectId")
    const sessionDate = searchParams.get("sessionDate")
    const scope = searchParams.get("scope")
    const materialTypeParam = searchParams.get("materialType")
    const materialType = materialTypeParam === "theory" || materialTypeParam === "practice" ? materialTypeParam : null

    if (!subjectId) {
      return badRequest("Missing subjectId")
    }

    if (materialTypeParam && !materialType) {
      return badRequest("Invalid materialType")
    }

    const forbidden = ensureSubjectAccess(auth.session!, subjectId)
    if (forbidden) return forbidden

    const rawWeekNumber = Number.parseInt(searchParams.get("weekNumber") || "", 10)
    let weekNumber = rawWeekNumber

    const shouldReconcile = Boolean(subjectId) && (!Number.isNaN(rawWeekNumber) || Boolean(sessionDate))

    if (scope === "week") {
      if (Number.isNaN(rawWeekNumber)) {
        return badRequest("Missing weekNumber")
      }

      if (shouldReconcile) {
        try {
          const result = await reconcileSubjectDayMaterialsFromR2({
            subjectId,
            weekNumber,
            materialType,
          })
          if (result.inserted > 0) {
            console.info("GET /api/subject-day-materials reconciled weekly materials from R2", {
              subjectId,
              weekNumber,
              materialType: materialType ?? "all",
              inserted: result.inserted,
              scanned: result.scanned,
              skipped: result.skipped,
            })
          } else if (result.scanned > 0) {
            console.info("GET /api/subject-day-materials weekly reconciliation scanned R2 without inserts", {
              subjectId,
              weekNumber,
              materialType: materialType ?? "all",
              scanned: result.scanned,
              skipped: result.skipped,
              diagnostics: result.diagnostics,
            })
          }
        } catch (error) {
          console.error("GET /api/subject-day-materials weekly reconciliation failed:", error)
        }
      }
    } else {
      if (!sessionDate) {
        return badRequest("Missing sessionDate")
      }

      const parsedSessionDate = parseSessionDate(sessionDate)
      if (!parsedSessionDate) {
        return badRequest("Invalid sessionDate")
      }

      weekNumber = Number.isNaN(rawWeekNumber) ? getWeekNumberForDate(parsedSessionDate) : rawWeekNumber
      if (shouldReconcile) {
        try {
          const result = await reconcileSubjectDayMaterialsFromR2({
            subjectId,
            weekNumber,
            sessionDate,
            materialType: null,
          })
          if (result.inserted > 0) {
            console.info("GET /api/subject-day-materials reconciled daily materials from R2", {
              subjectId,
              weekNumber,
              sessionDate,
              inserted: result.inserted,
              scanned: result.scanned,
              skipped: result.skipped,
            })
          } else if (result.scanned > 0) {
            console.info("GET /api/subject-day-materials daily reconciliation scanned R2 without inserts", {
              subjectId,
              weekNumber,
              sessionDate,
              scanned: result.scanned,
              skipped: result.skipped,
              diagnostics: result.diagnostics,
            })
          }
        } catch (error) {
          console.error("GET /api/subject-day-materials daily reconciliation failed:", error)
        }
      }
    }

    const rows = await listSubjectDayMaterials({
      subjectId,
      weekNumber,
      sessionDate: scope === "week" ? undefined : sessionDate!,
      materialType: scope === "week" ? materialType : materialType,
    })

    return NextResponse.json(rows)
  } catch (error) {
    console.error("GET /api/subject-day-materials error:", error)
    if (isMissingSubjectDayMaterialsTable(error)) {
      return NextResponse.json([])
    }
    return NextResponse.json({ error: "Failed to fetch materials" }, { status: 500 })
  }
}

export async function POST(request: Request) {
  void request
  return NextResponse.json(
    { error: "Legacy upload is disabled. Use /api/subject-day-materials/upload-session and /complete." },
    { status: 410 }
  )
}
