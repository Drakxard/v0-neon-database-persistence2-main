import { NextResponse } from "next/server"

import { ensureSubjectAccess, requireAuthSession } from "@/lib/authz"
import { getSocraticReviewQueue, isMissingSocraticReviewTable } from "@/lib/socratic-review"
import { getCurrentWeekNumber } from "@/lib/subject-utils"

function badRequest(message: string) {
  return NextResponse.json({ error: message }, { status: 400 })
}

export async function GET(request: Request) {
  try {
    const auth = await requireAuthSession()
    if (auth.response) return auth.response

    const { searchParams } = new URL(request.url)
    const subjectId = String(searchParams.get("subjectId") || "").trim()
    const rawWeekNumber = String(searchParams.get("weekNumber") || "current").trim().toLowerCase()
    const parsedWeekNumber = rawWeekNumber === "current" ? getCurrentWeekNumber() : Number.parseInt(rawWeekNumber, 10)

    if (!subjectId) {
      return badRequest("Missing subjectId")
    }

    if (!Number.isInteger(parsedWeekNumber) || parsedWeekNumber < 0) {
      return badRequest("Invalid weekNumber")
    }

    const forbidden = ensureSubjectAccess(auth.session!, subjectId)
    if (forbidden) return forbidden

    return NextResponse.json(
      await getSocraticReviewQueue({
        subjectId,
        weekNumber: parsedWeekNumber,
      })
    )
  } catch (error) {
    console.error("GET /api/socratic-review/queue error:", error)
    if (isMissingSocraticReviewTable(error)) {
      return NextResponse.json(
        { error: "Faltan tablas base para el repaso socratico. Verifica las migraciones de subject_day_entries." },
        { status: 503 }
      )
    }

    return NextResponse.json({ error: "No se pudo cargar la cola de repaso socratico." }, { status: 500 })
  }
}
