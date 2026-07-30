import { neon } from "@neondatabase/serverless"
import { requireSql } from "@/lib/db"
import { NextResponse } from "next/server"

import { getWeekNumberForDate, parseDateKey } from "@/lib/subject-utils"
import { ensureSubjectAccess, requireAuthSession } from "@/lib/authz"
import { listLocalSubjectDayEntries, listLocalSubjectDayMaterials } from "@/lib/local-r2-manifests"
import { isLocalStorageMode } from "@/lib/storage-mode"

export const runtime = "nodejs"

const sql = process.env.DATABASE_URL ? neon(process.env.DATABASE_URL) : null

type SubjectDayMaterialRow = {
  id: number
  subject_id: string
  week_number: number
  session_date: string
  weekday_index: number
  material_type: "theory" | "practice"
  order_index: number
  file_name: string
  drive_file_id: string
  drive_mime_type: string
  drive_web_view_link: string
  is_checkup_done: boolean
  created_at: string
  updated_at: string
}

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
  is_featured: boolean
  created_at: string
  updated_at: string
}

function isMissingTable(error: unknown) {
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

function normalizeSessionDateKey(sessionDate: string | Date) {
  if (sessionDate instanceof Date) {
    return `${sessionDate.getFullYear()}-${String(sessionDate.getMonth() + 1).padStart(2, "0")}-${String(sessionDate.getDate()).padStart(2, "0")}`
  }

  return sessionDate.includes("T") ? sessionDate.slice(0, 10) : sessionDate
}

function normalizeMaterial(row: SubjectDayMaterialRow | null) {
  if (!row) return null
  return {
    ...row,
    session_date: normalizeSessionDateKey(row.session_date),
  }
}

function getDisplayTitle(entry: Pick<EntryRow, "custom_title" | "order_index">) {
  const customTitle = entry.custom_title?.trim()
  return customTitle && customTitle.length > 0 ? customTitle : `Duda ${entry.order_index + 1}`
}

function normalizeEntry(row: EntryRow | null) {
  if (!row) return null
  return {
    ...row,
    session_date: normalizeSessionDateKey(row.session_date),
    display_title: getDisplayTitle(row),
    external_links: [],
  }
}

export async function GET(request: Request) {
  try {
    const auth = await requireAuthSession()
    if (auth.response) return auth.response

    const { searchParams } = new URL(request.url)
    const subjectId = searchParams.get("subjectId")
    const sessionDate = searchParams.get("sessionDate")

    if (!subjectId || !sessionDate) {
      return badRequest("Missing subjectId or sessionDate")
    }

    const forbidden = ensureSubjectAccess(auth.session!, subjectId)
    if (forbidden) return forbidden

    const parsedSessionDate = parseSessionDate(sessionDate)
    if (!parsedSessionDate) {
      return badRequest("Invalid sessionDate")
    }

    const rawWeekNumber = Number.parseInt(searchParams.get("weekNumber") || "", 10)
    const weekNumber = Number.isNaN(rawWeekNumber) ? getWeekNumberForDate(parsedSessionDate) : rawWeekNumber

    if (isLocalStorageMode()) {
      const material = (
        await listLocalSubjectDayMaterials({
          subjectId,
          weekNumber,
          sessionDate,
          materialType: "practice",
        })
      ).find((candidate) => !candidate.is_checkup_done) ?? null

      const previousFeaturedEntry =
        (
          await listLocalSubjectDayEntries({
            subjectId,
            weekNumber,
          })
        )
          .filter((entry) => entry.is_featured)
          .sort((left, right) => right.updated_at.localeCompare(left.updated_at))[0] ?? null

      return NextResponse.json({
        material,
        previousFeaturedEntry: previousFeaturedEntry
          ? {
              ...previousFeaturedEntry,
              display_title: previousFeaturedEntry.custom_title?.trim() || `Duda ${previousFeaturedEntry.order_index + 1}`,
            }
          : null,
      })
    }

    const materialRows = await requireSql(sql)`
      SELECT id, subject_id, week_number, session_date, weekday_index, material_type, order_index, file_name, drive_file_id, drive_mime_type, drive_web_view_link, is_checkup_done, created_at, updated_at
      FROM subject_day_materials
      WHERE subject_id = ${subjectId}
        AND week_number = ${weekNumber}
        AND session_date = ${sessionDate}
        AND material_type = 'practice'
        AND (
          container_id IS NULL OR EXISTS (
            SELECT 1 FROM subject_material_containers container
            WHERE container.id = subject_day_materials.container_id AND container.kind = 'practice'
          )
        )
        AND is_checkup_done = FALSE
      ORDER BY order_index ASC, id ASC
      LIMIT 1
    ` as SubjectDayMaterialRow[]

    let previousFeaturedEntry: EntryRow | null = null
    try {
      const previousEntryRows = await requireSql(sql)`
        SELECT id, subject_day_material_id, subject_id, week_number, session_date, weekday_index, order_index, transcript_text, drive_file_id, drive_file_name, drive_mime_type, drive_web_view_link, answer_text, custom_title, practice_state, is_featured, created_at, updated_at
        FROM subject_day_entries
        WHERE subject_id = ${subjectId}
          AND week_number = ${weekNumber}
          AND is_featured = TRUE
        ORDER BY updated_at DESC, session_date DESC, id DESC
        LIMIT 1
      ` as EntryRow[]
      previousFeaturedEntry = previousEntryRows[0] ?? null
    } catch (error) {
      if (!isMissingTable(error)) throw error
    }

    return NextResponse.json({
      material: normalizeMaterial(materialRows[0] ?? null),
      previousFeaturedEntry: normalizeEntry(previousFeaturedEntry),
    })
  } catch (error) {
    console.error("GET /api/subject-day-materials/next-practice error:", error)
    if (isMissingTable(error)) {
      return NextResponse.json({ material: null, previousFeaturedEntry: null })
    }
    return NextResponse.json({ error: "Failed to fetch next practice material" }, { status: 500 })
  }
}
