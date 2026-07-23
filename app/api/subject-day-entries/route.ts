import { neon } from "@neondatabase/serverless"
import { requireSql } from "@/lib/db"
import { NextResponse } from "next/server"

import { findLocalMaterialById, listLocalSubjectDayEntries, readEntryManifest, saveEntryManifest } from "@/lib/local-r2-manifests"
import { isLocalStorageMode } from "@/lib/storage-mode"
import { getWeekNumberForDate, getWeekdayIndexFromDateKey, parseDateKey } from "@/lib/subject-utils"
import { ensureSubjectAccess, requireAuthSession } from "@/lib/authz"

export const runtime = "nodejs"

const sql = process.env.DATABASE_URL ? neon(process.env.DATABASE_URL) : null

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

type EntryLinkRow = {
  id: number
  entry_id: number
  label: string
  url: string
  order_index: number
}

function isMissingSubjectDayEntriesTable(error: unknown) {
  return Boolean(
    error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "42P01"
  )
}

function isMissingColumn(error: unknown) {
  return Boolean(
    error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "42703"
  )
}

function isForeignKeyViolation(error: unknown) {
  return Boolean(
    error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "23503"
  )
}

function isGeminiQuotaError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error || "")
  return message.toLowerCase().includes("quota exceeded")
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

function getDisplayTitle(entry: Pick<EntryRow, "custom_title" | "order_index">) {
  const customTitle = entry.custom_title?.trim()
  return customTitle && customTitle.length > 0 ? customTitle : `Duda ${entry.order_index + 1}`
}

function normalizeSessionDateKey(sessionDate: string | Date) {
  if (sessionDate instanceof Date) {
    return `${sessionDate.getFullYear()}-${String(sessionDate.getMonth() + 1).padStart(2, "0")}-${String(sessionDate.getDate()).padStart(2, "0")}`
  }

  return sessionDate.includes("T") ? sessionDate.slice(0, 10) : sessionDate
}

async function getNextOrderIndex(params: {
  subjectId: string
  weekNumber: number
  sessionDate: string
  materialId: number | null
}) {
  const { subjectId, weekNumber, sessionDate, materialId } = params

  try {
    const [countRow] = await requireSql(sql)`
      SELECT COALESCE(MAX(order_index), -1) AS max_order
      FROM subject_day_entries
      WHERE subject_id = ${subjectId}
        AND week_number = ${weekNumber}
        AND session_date = ${sessionDate}
        AND (
          (${materialId}::INTEGER IS NULL AND subject_day_material_id IS NULL)
          OR subject_day_material_id = ${materialId}
        )
    `

    return Number(countRow?.max_order ?? -1) + 1
  } catch (error) {
    if (!isMissingColumn(error)) throw error

    const [countRow] = await requireSql(sql)`
      SELECT COALESCE(MAX(order_index), -1) AS max_order
      FROM subject_day_entries
      WHERE subject_id = ${subjectId}
        AND week_number = ${weekNumber}
        AND session_date = ${sessionDate}
    `

    return Number(countRow?.max_order ?? -1) + 1
  }
}

async function resolveMaterialId(params: {
  subjectId: string
  weekNumber: number
  sessionDate: string
  materialId: number | null
}) {
  const { subjectId, weekNumber, sessionDate, materialId } = params
  if (materialId == null) return null

  try {
    const rows = await requireSql(sql)`
      SELECT id
      FROM subject_day_materials
      WHERE id = ${materialId}
        AND subject_id = ${subjectId}
        AND week_number = ${weekNumber}
        AND session_date = ${sessionDate}
      LIMIT 1
    ` as Array<{ id: number }>

    return rows[0]?.id ?? null
  } catch (error) {
    if (isMissingSubjectDayEntriesTable(error)) {
      return null
    }
    throw error
  }
}

async function getEntryLinks(entryIds: number[]) {
  if (entryIds.length === 0) return new Map<number, EntryLinkRow[]>()

  let rows: EntryLinkRow[]
  try {
    rows = await requireSql(sql)`
      SELECT id, entry_id, label, url, order_index
      FROM subject_day_entry_links
      WHERE entry_id = ANY(${entryIds})
      ORDER BY entry_id ASC, order_index ASC, id ASC
    ` as EntryLinkRow[]
  } catch (error) {
    if (isMissingSubjectDayEntriesTable(error)) {
      return new Map<number, EntryLinkRow[]>()
    }
    throw error
  }

  const linksByEntry = new Map<number, EntryLinkRow[]>()
  for (const row of rows as EntryLinkRow[]) {
    const current = linksByEntry.get(row.entry_id) ?? []
    current.push(row)
    linksByEntry.set(row.entry_id, current)
  }

  return linksByEntry
}

async function withLinks(rows: EntryRow[]) {
  const linksByEntry = await getEntryLinks(rows.map((row) => row.id))
  return rows.map((row) => ({
    ...row,
    session_date: normalizeSessionDateKey(row.session_date),
    display_title: getDisplayTitle(row),
    external_links: (linksByEntry.get(row.id) ?? []).map((link) => ({
      id: link.id,
      label: link.label,
      url: link.url,
    })),
  }))
}

async function selectEntries(subjectId: string, weekNumber: number, sessionDate?: string, materialId?: number | null) {
  try {
    if (sessionDate) {
      return await requireSql(sql)`
        SELECT id, subject_day_material_id, subject_id, week_number, session_date, weekday_index, order_index, transcript_text, drive_file_id, drive_file_name, drive_mime_type, drive_web_view_link, answer_text, custom_title, practice_state, pair_id, pair_role, is_featured, created_at, updated_at
        FROM subject_day_entries
        WHERE subject_id = ${subjectId} AND week_number = ${weekNumber} AND session_date = ${sessionDate}
          AND (${materialId ?? null}::INTEGER IS NULL OR subject_day_material_id = ${materialId ?? null})
        ORDER BY session_date ASC, is_featured DESC, order_index ASC, id ASC
      ` as EntryRow[]
    }

    return await requireSql(sql)`
      SELECT id, subject_day_material_id, subject_id, week_number, session_date, weekday_index, order_index, transcript_text, drive_file_id, drive_file_name, drive_mime_type, drive_web_view_link, answer_text, custom_title, practice_state, pair_id, pair_role, is_featured, created_at, updated_at
      FROM subject_day_entries
      WHERE subject_id = ${subjectId} AND week_number = ${weekNumber}
        AND (${materialId ?? null}::INTEGER IS NULL OR subject_day_material_id = ${materialId ?? null})
      ORDER BY session_date ASC, is_featured DESC, order_index ASC, id ASC
    ` as EntryRow[]
  } catch (error) {
    if (!isMissingColumn(error)) throw error

    if (sessionDate) {
      return await requireSql(sql)`
        SELECT id, NULL::INTEGER AS subject_day_material_id, subject_id, week_number, session_date, weekday_index, order_index, transcript_text, drive_file_id, drive_file_name, drive_mime_type, drive_web_view_link, answer_text, NULL::TEXT AS custom_title, NULL::TEXT AS practice_state, NULL::TEXT AS pair_id, NULL::TEXT AS pair_role, FALSE AS is_featured, created_at, updated_at
        FROM subject_day_entries
        WHERE subject_id = ${subjectId} AND week_number = ${weekNumber} AND session_date = ${sessionDate}
        ORDER BY session_date ASC, order_index ASC, id ASC
      ` as EntryRow[]
    }

    return await requireSql(sql)`
      SELECT id, NULL::INTEGER AS subject_day_material_id, subject_id, week_number, session_date, weekday_index, order_index, transcript_text, drive_file_id, drive_file_name, drive_mime_type, drive_web_view_link, answer_text, NULL::TEXT AS custom_title, NULL::TEXT AS practice_state, NULL::TEXT AS pair_id, NULL::TEXT AS pair_role, FALSE AS is_featured, created_at, updated_at
      FROM subject_day_entries
      WHERE subject_id = ${subjectId} AND week_number = ${weekNumber}
      ORDER BY session_date ASC, order_index ASC, id ASC
    ` as EntryRow[]
  }
}

async function selectAllEntries(subjectId: string) {
  try {
    return await requireSql(sql)`
      SELECT id, subject_day_material_id, subject_id, week_number, session_date, weekday_index, order_index, transcript_text, drive_file_id, drive_file_name, drive_mime_type, drive_web_view_link, answer_text, custom_title, practice_state, pair_id, pair_role, is_featured, created_at, updated_at
      FROM subject_day_entries
      WHERE subject_id = ${subjectId}
      ORDER BY week_number ASC, session_date ASC, is_featured DESC, order_index ASC, id ASC
    ` as EntryRow[]
  } catch (error) {
    if (!isMissingColumn(error)) throw error

    return await requireSql(sql)`
      SELECT id, NULL::INTEGER AS subject_day_material_id, subject_id, week_number, session_date, weekday_index, order_index, transcript_text, drive_file_id, drive_file_name, drive_mime_type, drive_web_view_link, answer_text, NULL::TEXT AS custom_title, NULL::TEXT AS practice_state, NULL::TEXT AS pair_id, NULL::TEXT AS pair_role, FALSE AS is_featured, created_at, updated_at
      FROM subject_day_entries
      WHERE subject_id = ${subjectId}
      ORDER BY week_number ASC, session_date ASC, order_index ASC, id ASC
    ` as EntryRow[]
  }
}

export async function GET(request: Request) {
  try {
    const auth = await requireAuthSession()
    if (auth.response) return auth.response

    const { searchParams } = new URL(request.url)
    const subjectId = searchParams.get("subjectId")
    const sessionDate = searchParams.get("sessionDate")
    const parsedDate = sessionDate ? parseSessionDate(sessionDate) : null
    const rawMaterialId = Number.parseInt(searchParams.get("materialId") || "", 10)
    const materialId = Number.isNaN(rawMaterialId) ? null : rawMaterialId
    const rawWeekNumber = Number.parseInt(searchParams.get("weekNumber") || "", 10)
    const weekNumber = Number.isNaN(rawWeekNumber)
      ? parsedDate
        ? getWeekNumberForDate(parsedDate)
        : Number.NaN
      : rawWeekNumber

    if (!subjectId) {
      return badRequest("Missing subjectId")
    }

    const forbidden = ensureSubjectAccess(auth.session!, subjectId)
    if (forbidden) return forbidden

    if (isLocalStorageMode()) {
      const entries = await listLocalSubjectDayEntries({
        subjectId,
        weekNumber: Number.isNaN(weekNumber) ? undefined : weekNumber,
        sessionDate: sessionDate && parsedDate ? sessionDate : undefined,
        materialId,
      })

      return NextResponse.json(
        entries.map((entry) => ({
          ...entry,
          display_title: getDisplayTitle(entry),
        }))
      )
    }

    let rows: EntryRow[] = []
    if (sessionDate && parsedDate) {
      if (Number.isNaN(weekNumber)) {
        return badRequest("Missing weekNumber")
      }
      rows = await selectEntries(subjectId, weekNumber, sessionDate, materialId)
    } else if (sessionDate) {
      return badRequest("Invalid sessionDate")
    } else if (Number.isNaN(weekNumber)) {
      rows = await selectAllEntries(subjectId)
    } else {
      rows = await selectEntries(subjectId, weekNumber, undefined, materialId)
    }

    return NextResponse.json(await withLinks(rows))
  } catch (error) {
    console.error("GET /api/subject-day-entries error:", error)
    if (isMissingSubjectDayEntriesTable(error)) {
      return NextResponse.json([])
    }
    return NextResponse.json({ error: "Failed to fetch entries" }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const auth = await requireAuthSession()
    if (auth.response) return auth.response

    const body = await request.json()
    const subjectId = String(body?.subjectId || "").trim()
    const sessionDate = String(body?.sessionDate || "").trim()
    const parsedSessionDate = parseSessionDate(sessionDate)
    const requestedWeekNumber = Number.parseInt(String(body?.weekNumber || ""), 10)
    const requestedWeekdayIndex = Number.parseInt(String(body?.weekdayIndex || ""), 10)
    const rawMaterialId = Number.parseInt(String(body?.materialId || ""), 10)
    const materialId = Number.isNaN(rawMaterialId) ? null : rawMaterialId
    const transcriptText = String(body?.transcriptText || "").trim()
    const answerText = typeof body?.answerText === "string" ? body.answerText.trim() : ""
    const customTitle = typeof body?.customTitle === "string" ? body.customTitle.trim() : ""

    if (!subjectId) {
      return badRequest("Missing subjectId")
    }

    const forbidden = ensureSubjectAccess(auth.session!, subjectId)
    if (forbidden) return forbidden

    if (!sessionDate || !parsedSessionDate) {
      return badRequest("Invalid sessionDate")
    }

    if (!transcriptText) {
      return badRequest("Missing transcriptText")
    }

    const derivedWeekNumber = getWeekNumberForDate(parsedSessionDate)
    const weekNumber =
      Number.isNaN(requestedWeekNumber) || requestedWeekNumber !== derivedWeekNumber ? derivedWeekNumber : requestedWeekNumber
    const weekdayIndex =
      Number.isNaN(requestedWeekdayIndex) ? getWeekdayIndexFromDateKey(sessionDate) : requestedWeekdayIndex

    if (isLocalStorageMode()) {
      const targetMaterial = materialId == null ? null : await findLocalMaterialById(materialId)
      const resolvedSubjectId = targetMaterial?.subject_id ?? subjectId
      const resolvedWeekNumber = targetMaterial?.week_number ?? weekNumber
      const resolvedSessionDate = targetMaterial?.session_date ?? sessionDate
      const resolvedWeekdayIndex = targetMaterial?.weekday_index ?? weekdayIndex
      const resolvedMaterialId = targetMaterial?.id ?? null
      const manifest = await readEntryManifest(resolvedSubjectId, resolvedWeekNumber)
      const siblingEntries = manifest.entries.filter(
        (entry) =>
          entry.session_date === resolvedSessionDate &&
          (entry.subject_day_material_id ?? null) === resolvedMaterialId
      )
      const nextOrderIndex = siblingEntries.length
      const now = new Date().toISOString()
      const createdEntry = {
        id: Number(`${Date.now()}${Math.floor(Math.random() * 100).toString().padStart(2, "0")}`),
        subject_day_material_id: resolvedMaterialId,
        subject_id: resolvedSubjectId,
        week_number: resolvedWeekNumber,
        session_date: resolvedSessionDate,
        weekday_index: resolvedWeekdayIndex,
        order_index: nextOrderIndex,
        transcript_text: transcriptText,
        drive_file_id: "",
        drive_file_name: "",
        drive_mime_type: "text/plain",
        drive_web_view_link: "",
        answer_text: answerText || null,
        custom_title: customTitle || null,
        practice_state: null,
        pair_id: null,
        pair_role: null,
        is_featured: false,
        created_at: now,
        updated_at: now,
        external_links: [],
        audio_position: null,
      }

      await saveEntryManifest(resolvedSubjectId, resolvedWeekNumber, [...manifest.entries, createdEntry])
      return NextResponse.json({
        ...createdEntry,
        display_title: getDisplayTitle(createdEntry),
      })
    }

    const resolvedMaterialId = await resolveMaterialId({
      subjectId,
      weekNumber,
      sessionDate,
      materialId,
    })

    const nextOrderIndex = await getNextOrderIndex({
      subjectId,
      weekNumber,
      sessionDate,
      materialId: resolvedMaterialId,
    })

    let rows: EntryRow[] = []
    try {
      rows = await requireSql(sql)`
        INSERT INTO subject_day_entries (
          subject_id,
          subject_day_material_id,
          week_number,
          session_date,
          weekday_index,
          order_index,
          transcript_text,
          drive_file_id,
          drive_file_name,
          drive_mime_type,
          drive_web_view_link,
          answer_text,
          custom_title
        )
        VALUES (
          ${subjectId},
          ${resolvedMaterialId},
          ${weekNumber},
          ${sessionDate},
          ${weekdayIndex},
          ${nextOrderIndex},
          ${transcriptText},
          '',
          '',
          'text/plain',
          '',
          ${answerText || null},
          ${customTitle || null}
        )
        RETURNING id, subject_day_material_id, subject_id, week_number, session_date, weekday_index, order_index, transcript_text, drive_file_id, drive_file_name, drive_mime_type, drive_web_view_link, answer_text, custom_title, practice_state, NULL::TEXT AS pair_id, NULL::TEXT AS pair_role, is_featured, created_at, updated_at
      ` as EntryRow[]
    } catch (error) {
      if (isForeignKeyViolation(error) && resolvedMaterialId != null) {
        rows = await requireSql(sql)`
          INSERT INTO subject_day_entries (
            subject_id,
            subject_day_material_id,
            week_number,
            session_date,
            weekday_index,
            order_index,
            transcript_text,
            drive_file_id,
            drive_file_name,
            drive_mime_type,
            drive_web_view_link,
            answer_text,
            custom_title
          )
          VALUES (
            ${subjectId},
            ${null},
            ${weekNumber},
            ${sessionDate},
            ${weekdayIndex},
            ${nextOrderIndex},
            ${transcriptText},
            '',
            '',
            'text/plain',
            '',
            ${answerText || null},
            ${customTitle || null}
          )
          RETURNING id, subject_day_material_id, subject_id, week_number, session_date, weekday_index, order_index, transcript_text, drive_file_id, drive_file_name, drive_mime_type, drive_web_view_link, answer_text, custom_title, practice_state, NULL::TEXT AS pair_id, NULL::TEXT AS pair_role, is_featured, created_at, updated_at
        ` as EntryRow[]
      } else if (!isMissingColumn(error)) {
        throw error
      }

      if (isMissingColumn(error)) {
        rows = await requireSql(sql)`
          INSERT INTO subject_day_entries (
            subject_id,
            week_number,
            session_date,
            weekday_index,
            order_index,
            transcript_text,
            drive_file_id,
            drive_file_name,
            drive_mime_type,
            drive_web_view_link,
            answer_text
          )
          VALUES (
            ${subjectId},
            ${weekNumber},
            ${sessionDate},
            ${weekdayIndex},
            ${nextOrderIndex},
            ${transcriptText},
            '',
            '',
            'text/plain',
            '',
            ${answerText || null}
          )
          RETURNING id, NULL::INTEGER AS subject_day_material_id, subject_id, week_number, session_date, weekday_index, order_index, transcript_text, drive_file_id, drive_file_name, drive_mime_type, drive_web_view_link, answer_text, NULL::TEXT AS custom_title, NULL::TEXT AS practice_state, NULL::TEXT AS pair_id, NULL::TEXT AS pair_role, FALSE AS is_featured, created_at, updated_at
        ` as EntryRow[]
      }
    }

    const [entryWithLinks] = await withLinks(rows)
    return NextResponse.json(entryWithLinks)
  } catch (error) {
    console.error("POST /api/subject-day-entries error:", error)
    if (isMissingSubjectDayEntriesTable(error)) {
      return NextResponse.json(
        { error: "Falta crear la tabla subject_day_entries. Ejecuta scripts/005-create-subject-day-entries.sql y scripts/006-add-subject-day-entry-metadata.sql en Neon." },
        { status: 503 }
      )
    }
    if (isMissingColumn(error)) {
      return NextResponse.json(
        { error: "Falta ejecutar las migraciones de subject_day_entries en Neon (scripts/006, 007 y/o 009) para usar esta funcion." },
        { status: 409 }
      )
    }
    return NextResponse.json({ error: "Failed to create entry" }, { status: 500 })
  }
}
