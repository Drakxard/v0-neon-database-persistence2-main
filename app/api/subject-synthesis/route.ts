import { neon } from "@neondatabase/serverless"
import { NextResponse } from "next/server"

import { ensureSubjectAccess, requireAuthSession } from "@/lib/authz"
import type { SubjectSynthesisRecord } from "@/lib/study-types"

export const runtime = "nodejs"

const sql = process.env.DATABASE_URL ? neon(process.env.DATABASE_URL) : null

function isMissingSubjectSynthesisTable(error: unknown) {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "42P01")
}

function badRequest(message: string) {
  return NextResponse.json({ error: message }, { status: 400 })
}

function normalizeSubjectSynthesisRow(row: {
  subject_id: string
  week_number: number
  exercise_solved_count: number
  exercise_total_count: number
  exercise_skipped_text: string | null
  updated_at: string | null
}): SubjectSynthesisRecord {
  return {
    subjectId: row.subject_id,
    weekNumber: Number(row.week_number),
    exerciseSolvedCount: Number(row.exercise_solved_count ?? 0),
    exerciseTotalCount: Number(row.exercise_total_count ?? 0),
    exerciseSkippedText: row.exercise_skipped_text ?? "",
    updatedAt: row.updated_at ?? null,
  }
}

function getDefaultSubjectSynthesis(subjectId: string, weekNumber: number): SubjectSynthesisRecord {
  return {
    subjectId,
    weekNumber,
    exerciseSolvedCount: 0,
    exerciseTotalCount: 0,
    exerciseSkippedText: "",
    updatedAt: null,
  }
}

export async function GET(request: Request) {
  try {
    const auth = await requireAuthSession()
    if (auth.response) return auth.response

    const { searchParams } = new URL(request.url)
    const subjectId = String(searchParams.get("subjectId") || "").trim()
    const weekNumber = Number.parseInt(String(searchParams.get("weekNumber") || ""), 10)

    if (!subjectId) {
      return badRequest("Missing subjectId")
    }

    if (!Number.isInteger(weekNumber) || weekNumber < 0) {
      return badRequest("Invalid weekNumber")
    }

    const forbidden = ensureSubjectAccess(auth.session!, subjectId)
    if (forbidden) return forbidden

    const rows = await sql`
      SELECT subject_id, week_number, exercise_solved_count, exercise_total_count, exercise_skipped_text, updated_at
      FROM subject_synthesis_weeks
      WHERE subject_id = ${subjectId}
        AND week_number = ${weekNumber}
      LIMIT 1
    ` as Array<{
      subject_id: string
      week_number: number
      exercise_solved_count: number
      exercise_total_count: number
      exercise_skipped_text: string | null
      updated_at: string | null
    }>

    return NextResponse.json(rows[0] ? normalizeSubjectSynthesisRow(rows[0]) : getDefaultSubjectSynthesis(subjectId, weekNumber))
  } catch (error) {
    console.error("GET /api/subject-synthesis error:", error)
    if (isMissingSubjectSynthesisTable(error)) {
      const { searchParams } = new URL(request.url)
      const subjectId = String(searchParams.get("subjectId") || "").trim()
      const weekNumber = Number.parseInt(String(searchParams.get("weekNumber") || ""), 10)
      if (subjectId && Number.isInteger(weekNumber) && weekNumber >= 0) {
        return NextResponse.json(getDefaultSubjectSynthesis(subjectId, weekNumber))
      }
    }

    return NextResponse.json({ error: "No se pudo cargar la sintesis semanal." }, { status: 500 })
  }
}

export async function PUT(request: Request) {
  try {
    const auth = await requireAuthSession()
    if (auth.response) return auth.response

    const body = await request.json()
    const subjectId = String(body?.subjectId || "").trim()
    const weekNumber = Number.parseInt(String(body?.weekNumber || ""), 10)
    const exerciseSolvedCount = Number.parseInt(String(body?.exerciseSolvedCount ?? ""), 10)
    const exerciseTotalCount = Number.parseInt(String(body?.exerciseTotalCount ?? ""), 10)
    const exerciseSkippedText = typeof body?.exerciseSkippedText === "string" ? body.exerciseSkippedText : ""

    if (!subjectId) {
      return badRequest("Missing subjectId")
    }

    if (!Number.isInteger(weekNumber) || weekNumber < 0) {
      return badRequest("Invalid weekNumber")
    }

    if (!Number.isInteger(exerciseSolvedCount) || exerciseSolvedCount < 0) {
      return badRequest("Invalid exerciseSolvedCount")
    }

    if (!Number.isInteger(exerciseTotalCount) || exerciseTotalCount < 0) {
      return badRequest("Invalid exerciseTotalCount")
    }

    const forbidden = ensureSubjectAccess(auth.session!, subjectId)
    if (forbidden) return forbidden

    const rows = await sql`
      INSERT INTO subject_synthesis_weeks (
        subject_id,
        week_number,
        exercise_solved_count,
        exercise_total_count,
        exercise_skipped_text
      ) VALUES (
        ${subjectId},
        ${weekNumber},
        ${exerciseSolvedCount},
        ${exerciseTotalCount},
        ${exerciseSkippedText.trim() || null}
      )
      ON CONFLICT (subject_id, week_number)
      DO UPDATE SET
        exercise_solved_count = EXCLUDED.exercise_solved_count,
        exercise_total_count = EXCLUDED.exercise_total_count,
        exercise_skipped_text = EXCLUDED.exercise_skipped_text,
        updated_at = NOW()
      RETURNING subject_id, week_number, exercise_solved_count, exercise_total_count, exercise_skipped_text, updated_at
    ` as Array<{
      subject_id: string
      week_number: number
      exercise_solved_count: number
      exercise_total_count: number
      exercise_skipped_text: string | null
      updated_at: string | null
    }>

    return NextResponse.json(normalizeSubjectSynthesisRow(rows[0]))
  } catch (error) {
    console.error("PUT /api/subject-synthesis error:", error)
    if (isMissingSubjectSynthesisTable(error)) {
      return NextResponse.json(
        { error: "Falta crear la tabla subject_synthesis_weeks. Ejecuta scripts/020-create-subject-synthesis-weeks.sql en Neon." },
        { status: 503 }
      )
    }

    return NextResponse.json({ error: "No se pudo guardar la sintesis semanal." }, { status: 500 })
  }
}
