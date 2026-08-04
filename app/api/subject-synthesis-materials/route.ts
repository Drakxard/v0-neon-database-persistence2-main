import { getLegacyDatabase } from "@/lib/db"
import { requireSql } from "@/lib/db"
import { NextResponse } from "next/server"

import { ensureSubjectAccess, requireAuthSession } from "@/lib/authz"
import { listSubjectDayMaterials, reconcileSubjectDayMaterialsFromR2 } from "@/lib/subject-day-materials-r2"
import { getSubjectDayMaterialMetadataOrAutocleanup } from "@/lib/subject-day-materials-storage"
import type {
  SubjectDayEntry,
  SubjectDayMaterial,
  SubjectMaterialSynthesisRecord,
  SubjectSynthesisRecord,
  SubjectSynthesisSubjectPayload,
} from "@/lib/study-types"

export const runtime = "nodejs"

const sql = getLegacyDatabase()

type EntryRow = {
  id: number
  subject_day_material_id: number | null
  subject_id: string
  week_number: number
  session_date: string
  weekday_index: number
  order_index: number
  transcript_text: string
  drive_file_id: string
  drive_file_name: string
  drive_mime_type: string
  drive_web_view_link: string
  answer_text: string | null
  custom_title: string | null
  practice_state: "erre" | null
  pair_id: string | null
  pair_role: "question" | "answer" | null
  is_featured: boolean
  created_at: string
  updated_at: string
}

function badRequest(message: string) {
  return NextResponse.json({ error: message }, { status: 400 })
}

function isMissingTable(error: unknown) {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "42P01")
}

function isMissingColumn(error: unknown) {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "42703")
}

function normalizeSessionDateKey(sessionDate: string | Date) {
  if (sessionDate instanceof Date) {
    return `${sessionDate.getFullYear()}-${String(sessionDate.getMonth() + 1).padStart(2, "0")}-${String(sessionDate.getDate()).padStart(2, "0")}`
  }

  return sessionDate.includes("T") ? sessionDate.slice(0, 10) : sessionDate
}

function getEntryDisplayTitle(entry: Pick<EntryRow, "custom_title" | "order_index">) {
  const customTitle = entry.custom_title?.trim()
  return customTitle && customTitle.length > 0 ? customTitle : `Duda ${entry.order_index + 1}`
}

function getDefaultLegacySummary(subjectId: string, weekNumber: number): SubjectSynthesisRecord {
  return {
    subjectId,
    weekNumber,
    exerciseSolvedCount: 0,
    exerciseTotalCount: 0,
    exerciseSkippedText: "",
    updatedAt: null,
  }
}

function normalizeLegacySummary(
  subjectId: string,
  weekNumber: number,
  row?: {
    exercise_solved_count: number
    exercise_total_count: number
    exercise_skipped_text: string | null
    updated_at: string | null
  }
): SubjectSynthesisRecord {
  if (!row) {
    return getDefaultLegacySummary(subjectId, weekNumber)
  }

  return {
    subjectId,
    weekNumber,
    exerciseSolvedCount: Number(row.exercise_solved_count ?? 0),
    exerciseTotalCount: Number(row.exercise_total_count ?? 0),
    exerciseSkippedText: row.exercise_skipped_text ?? "",
    updatedAt: row.updated_at ?? null,
  }
}

async function selectEntries(subjectId: string, weekNumber: number) {
  try {
    const rows = await requireSql(sql)`
      SELECT id, subject_day_material_id, subject_id, week_number, session_date, weekday_index, order_index, transcript_text, drive_file_id, drive_file_name, drive_mime_type, drive_web_view_link, answer_text, custom_title, practice_state, pair_id, pair_role, is_featured, created_at, updated_at
      FROM subject_day_entries
      WHERE subject_id = ${subjectId} AND week_number = ${weekNumber}
      ORDER BY session_date ASC, is_featured DESC, order_index ASC, id ASC
    ` as EntryRow[]

    return rows.map((row) => ({
      ...row,
      session_date: normalizeSessionDateKey(row.session_date),
      display_title: getEntryDisplayTitle(row),
      external_links: [],
    })) as SubjectDayEntry[]
  } catch (error) {
    if (isMissingTable(error)) {
      return []
    }

    if (!isMissingColumn(error)) {
      throw error
    }

    const rows = await requireSql(sql)`
      SELECT id, NULL::INTEGER AS subject_day_material_id, subject_id, week_number, session_date, weekday_index, order_index, transcript_text, drive_file_id, drive_file_name, drive_mime_type, drive_web_view_link, answer_text, NULL::TEXT AS custom_title, NULL::TEXT AS practice_state, NULL::TEXT AS pair_id, NULL::TEXT AS pair_role, FALSE AS is_featured, created_at, updated_at
      FROM subject_day_entries
      WHERE subject_id = ${subjectId} AND week_number = ${weekNumber}
      ORDER BY session_date ASC, order_index ASC, id ASC
    ` as EntryRow[]

    return rows.map((row) => ({
      ...row,
      session_date: normalizeSessionDateKey(row.session_date),
      display_title: getEntryDisplayTitle(row),
      external_links: [],
    })) as SubjectDayEntry[]
  }
}

async function selectVisibleMaterials(subjectId: string, weekNumber: number) {
  try {
    await reconcileSubjectDayMaterialsFromR2({
      subjectId,
      weekNumber,
      materialType: null,
    })
  } catch (error) {
    console.error("GET /api/subject-synthesis-materials reconciliation failed:", error)
  }

  const rows = await listSubjectDayMaterials({ subjectId, weekNumber })
  const availabilityChecks = await Promise.all(
    rows.map(async (row) => ({
      row,
      remote: await getSubjectDayMaterialMetadataOrAutocleanup({
        id: row.id,
        drive_file_id: row.drive_file_id,
      }),
    }))
  )

  return availabilityChecks
    .filter((item) => item.remote.status !== "missing")
    .map((item) => item.row) as SubjectDayMaterial[]
}

async function selectMaterialProgress(subjectId: string, weekNumber: number) {
  try {
    const rows = await requireSql(sql)`
      SELECT sms.subject_day_material_id, sms.exercise_scope_text, sms.exercise_solved_count, sms.exercise_total_count, sms.updated_at
      FROM subject_material_synthesis AS sms
      INNER JOIN subject_day_materials AS materials
        ON materials.id = sms.subject_day_material_id
      WHERE materials.subject_id = ${subjectId}
        AND materials.week_number = ${weekNumber}
      ORDER BY materials.session_date ASC, materials.material_type ASC, materials.order_index ASC, materials.id ASC
    ` as Array<{
      subject_day_material_id: number
      exercise_scope_text: string | null
      exercise_solved_count: number
      exercise_total_count: number
      updated_at: string | null
    }>

    return rows.map((row) => ({
      subjectDayMaterialId: Number(row.subject_day_material_id),
      exerciseScopeText: row.exercise_scope_text ?? "",
      exerciseSolvedCount: Number(row.exercise_solved_count ?? 0),
      exerciseTotalCount: Number(row.exercise_total_count ?? 0),
      updatedAt: row.updated_at ?? null,
    })) as SubjectMaterialSynthesisRecord[]
  } catch (error) {
    if (isMissingTable(error)) {
      return []
    }
    throw error
  }
}

async function selectLegacySummary(subjectId: string, weekNumber: number) {
  try {
    const rows = await requireSql(sql)`
      SELECT exercise_solved_count, exercise_total_count, exercise_skipped_text, updated_at
      FROM subject_synthesis_weeks
      WHERE subject_id = ${subjectId}
        AND week_number = ${weekNumber}
      LIMIT 1
    ` as Array<{
      exercise_solved_count: number
      exercise_total_count: number
      exercise_skipped_text: string | null
      updated_at: string | null
    }>

    return normalizeLegacySummary(subjectId, weekNumber, rows[0])
  } catch (error) {
    if (isMissingTable(error)) {
      return getDefaultLegacySummary(subjectId, weekNumber)
    }
    throw error
  }
}

async function buildPayload(subjectId: string, weekNumber: number): Promise<SubjectSynthesisSubjectPayload> {
  const [materials, entries, materialProgress, legacySummary] = await Promise.all([
    selectVisibleMaterials(subjectId, weekNumber),
    selectEntries(subjectId, weekNumber),
    selectMaterialProgress(subjectId, weekNumber),
    selectLegacySummary(subjectId, weekNumber),
  ])

  return {
    subjectId,
    weekNumber,
    materials,
    entries,
    materialProgress,
    legacySummary,
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

    return NextResponse.json(await buildPayload(subjectId, weekNumber))
  } catch (error) {
    console.error("GET /api/subject-synthesis-materials error:", error)
    return NextResponse.json({ error: "No se pudo cargar la sintesis por archivo." }, { status: 500 })
  }
}

export async function PUT(request: Request) {
  try {
    const auth = await requireAuthSession()
    if (auth.response) return auth.response

    const body = await request.json()
    const subjectId = String(body?.subjectId || "").trim()
    const weekNumber = Number.parseInt(String(body?.weekNumber || ""), 10)
    const rawItems = Array.isArray(body?.items) ? body.items : null

    if (!subjectId) {
      return badRequest("Missing subjectId")
    }

    if (!Number.isInteger(weekNumber) || weekNumber < 0) {
      return badRequest("Invalid weekNumber")
    }

    if (!rawItems) {
      return badRequest("Invalid items")
    }

    const forbidden = ensureSubjectAccess(auth.session!, subjectId)
    if (forbidden) return forbidden

    const items = rawItems.map((item: unknown) => {
      const candidate = item as {
        subjectDayMaterialId?: unknown
        exerciseScopeText?: unknown
        exerciseSolvedCount?: unknown
        exerciseTotalCount?: unknown
      }

      return {
        subjectDayMaterialId: Number.parseInt(String(candidate.subjectDayMaterialId || ""), 10),
        exerciseScopeText: typeof candidate.exerciseScopeText === "string" ? candidate.exerciseScopeText : "",
        exerciseSolvedCount: Number.parseInt(String(candidate.exerciseSolvedCount ?? ""), 10),
        exerciseTotalCount: Number.parseInt(String(candidate.exerciseTotalCount ?? ""), 10),
      }
    })

    if (
      items.some(
        (item: {
          subjectDayMaterialId: number
          exerciseScopeText: string
          exerciseSolvedCount: number
          exerciseTotalCount: number
        }) =>
          !Number.isInteger(item.subjectDayMaterialId) ||
          item.subjectDayMaterialId <= 0 ||
          !Number.isInteger(item.exerciseSolvedCount) ||
          item.exerciseSolvedCount < 0 ||
          !Number.isInteger(item.exerciseTotalCount) ||
          item.exerciseTotalCount < 0
      )
    ) {
      return badRequest("Invalid synthesis items")
    }

    const uniqueMaterialIds = Array.from(new Set(items.map((item: {
      subjectDayMaterialId: number
      exerciseScopeText: string
      exerciseSolvedCount: number
      exerciseTotalCount: number
    }) => item.subjectDayMaterialId)))
    if (uniqueMaterialIds.length > 0) {
      const rows = await requireSql(sql)`
        SELECT id
        FROM subject_day_materials
        WHERE subject_id = ${subjectId}
          AND week_number = ${weekNumber}
          AND id = ANY(${uniqueMaterialIds})
      ` as Array<{ id: number }>

      if (rows.length !== uniqueMaterialIds.length) {
        return badRequest("Hay materiales que no pertenecen a la materia o semana seleccionada.")
      }
    }

    for (const item of items) {
      const trimmedScopeText = item.exerciseScopeText.trim()
      const isBlank = trimmedScopeText.length === 0 && item.exerciseSolvedCount === 0 && item.exerciseTotalCount === 0

      if (isBlank) {
        await requireSql(sql)`
          DELETE FROM subject_material_synthesis
          WHERE subject_day_material_id = ${item.subjectDayMaterialId}
        `
        continue
      }

      await requireSql(sql)`
        INSERT INTO subject_material_synthesis (
          subject_day_material_id,
          exercise_scope_text,
          exercise_solved_count,
          exercise_total_count
        )
        VALUES (
          ${item.subjectDayMaterialId},
          ${trimmedScopeText || null},
          ${item.exerciseSolvedCount},
          ${item.exerciseTotalCount}
        )
        ON CONFLICT (subject_day_material_id)
        DO UPDATE SET
          exercise_scope_text = EXCLUDED.exercise_scope_text,
          exercise_solved_count = EXCLUDED.exercise_solved_count,
          exercise_total_count = EXCLUDED.exercise_total_count,
          updated_at = NOW()
      `
    }

    return NextResponse.json(await buildPayload(subjectId, weekNumber))
  } catch (error) {
    console.error("PUT /api/subject-synthesis-materials error:", error)
    if (isMissingTable(error)) {
      return NextResponse.json(
        { error: "Falta crear la tabla subject_material_synthesis. Ejecuta scripts/021-create-subject-material-synthesis.sql en Neon." },
        { status: 503 }
      )
    }

    return NextResponse.json({ error: "No se pudo guardar la sintesis por archivo." }, { status: 500 })
  }
}
