import { neon } from "@neondatabase/serverless"
import { NextResponse } from "next/server"

import { transcribeAudioWithGemini } from "@/lib/gemini"
import { deleteDriveFile, downloadDriveFile, getDriveFileMetadata } from "@/lib/google-drive"
import { readEntryManifest, saveEntryManifest } from "@/lib/local-r2-manifests"
import { deleteR2Object, downloadR2Object, getR2ObjectMetadata, isR2ObjectKey } from "@/lib/r2"
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

function badRequest(message: string) {
  return NextResponse.json({ error: message }, { status: 400 })
}

function isMissingPairColumns(error: unknown) {
  return Boolean(
    error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "42703"
  )
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
    const [countRow] = await sql`
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

    const [countRow] = await sql`
      SELECT COALESCE(MAX(order_index), -1) AS max_order
      FROM subject_day_entries
      WHERE subject_id = ${subjectId}
        AND week_number = ${weekNumber}
        AND session_date = ${sessionDate}
    `

    return Number(countRow?.max_order ?? -1) + 1
  }
}

type CompletionPayload =
  {
    subjectId: string
    sessionDate: string
    weekNumber: number
    materialId: number | null
    driveFileId: string
    fileName: string
    pairId: string | null
    pairRole: "question" | "answer" | null
  }

async function parseCompletionPayload(request: Request): Promise<CompletionPayload> {
  const payload = await request.json()
  const rawMaterialId = Number.parseInt(String(payload?.materialId || ""), 10)
  return {
    subjectId: String(payload?.subjectId || "").trim(),
    sessionDate: String(payload?.sessionDate || "").trim(),
    weekNumber: Number.parseInt(String(payload?.weekNumber || ""), 10),
    materialId: Number.isNaN(rawMaterialId) ? null : rawMaterialId,
    driveFileId: String(payload?.driveFileId || "").trim(),
    fileName: String(payload?.fileName || "").trim(),
    pairId: typeof payload?.pairId === "string" ? payload.pairId.trim() || null : null,
    pairRole: payload?.pairRole === "question" || payload?.pairRole === "answer" ? payload.pairRole : null,
  }
}

function formatEntry(row: EntryRow) {
  return {
    ...row,
    session_date: normalizeSessionDateKey(row.session_date),
    display_title: getDisplayTitle(row),
    external_links: [],
  }
}

export async function POST(request: Request) {
  try {
    const auth = await requireAuthSession()
    if (auth.response) return auth.response

    const payload = await parseCompletionPayload(request)
    const subjectId = payload.subjectId
    const sessionDate = payload.sessionDate
    const parsedSessionDate = parseSessionDate(sessionDate)
    const requestedWeekNumber = payload.weekNumber
    const materialId = payload.materialId
    const uploadedFileName = payload.fileName
    const pairId = payload.pairId
    const pairRole = payload.pairRole

    if (!subjectId || !sessionDate || !parsedSessionDate || !payload.driveFileId) {
      return badRequest("Missing completion metadata")
    }

    if ((pairId && !pairRole) || (!pairId && pairRole)) {
      return badRequest("Invalid audio pair metadata")
    }

    const forbidden = ensureSubjectAccess(auth.session!, subjectId)
    if (forbidden) return forbidden

    const driveFile = isR2ObjectKey(payload.driveFileId)
      ? await getR2ObjectMetadata(payload.driveFileId)
      : await getDriveFileMetadata(payload.driveFileId)

    if (!driveFile.mimeType.startsWith("audio/")) {
      return badRequest("Invalid audio mime type")
    }

    const derivedWeekNumber = getWeekNumberForDate(parsedSessionDate)
    const weekNumber =
      Number.isNaN(requestedWeekNumber) || requestedWeekNumber !== derivedWeekNumber ? derivedWeekNumber : requestedWeekNumber
    const weekdayIndex = getWeekdayIndexFromDateKey(sessionDate)

    const nextOrderIndex = await getNextOrderIndex({
      subjectId,
      weekNumber,
      sessionDate,
      materialId,
    })

    if (isLocalStorageMode()) {
      const manifest = await readEntryManifest(subjectId, weekNumber)
      const pairRows = pairId
        ? manifest.entries.filter((entry) => entry.pair_id === pairId)
        : []
      const existingRoleRow = pairId && pairRole ? pairRows.find((entry) => entry.pair_role === pairRole) ?? null : null

      if (pairId && existingRoleRow) {
        return badRequest("Audio pair role already exists")
      }

      let transcriptText = uploadedFileName || "Audio"
      try {
        const downloadedFile = isR2ObjectKey(driveFile.id)
          ? await downloadR2Object(driveFile.id)
          : await downloadDriveFile(driveFile.id)
        const transcription = await transcribeAudioWithGemini(downloadedFile.buffer, downloadedFile.mimeType || driveFile.mimeType)
        if (transcription?.trim()) {
          transcriptText = transcription.trim()
        }
      } catch (error) {
        console.warn("Local audio transcription fallback warning:", error)
      }

      const now = new Date().toISOString()
      const entry = {
        id: Number(`${Date.now()}${Math.floor(Math.random() * 100).toString().padStart(2, "0")}`),
        subject_day_material_id: materialId,
        subject_id: subjectId,
        week_number: weekNumber,
        session_date: sessionDate,
        weekday_index: weekdayIndex,
        order_index: nextOrderIndex,
        transcript_text: transcriptText,
        drive_file_id: driveFile.id,
        drive_file_name: uploadedFileName || driveFile.name,
        drive_mime_type: driveFile.mimeType,
        drive_web_view_link: "",
        answer_text: null,
        custom_title: null,
        practice_state: null,
        pair_id: pairId,
        pair_role: pairRole,
        is_featured: false,
        created_at: now,
        updated_at: now,
        external_links: [],
        audio_position: null,
      }

      await saveEntryManifest(subjectId, weekNumber, [...manifest.entries, entry])
      return NextResponse.json(formatEntry(entry as EntryRow))
    }

    if (pairId && pairRole) {
      let pairRows: Array<{
        id: number
        subject_id: string
        week_number: number
        session_date: string
        subject_day_material_id: number | null
        drive_file_id: string
        pair_role: "question" | "answer" | null
      }>
      try {
        pairRows = await sql`
          SELECT id, subject_id, week_number, session_date, subject_day_material_id, drive_file_id, pair_role
          FROM subject_day_entries
          WHERE pair_id = ${pairId}
          ORDER BY id ASC
        ` as Array<{
          id: number
          subject_id: string
          week_number: number
          session_date: string
          subject_day_material_id: number | null
          drive_file_id: string
          pair_role: "question" | "answer" | null
        }>
      } catch (error) {
        if (!isMissingPairColumns(error)) throw error
        return NextResponse.json(
          {
            error:
              "No se puede guardar la dupla de audio porque falta aplicar scripts/016-add-subject-day-entry-audio-pairs.sql en Neon.",
            code: "MISSING_AUDIO_PAIR_COLUMNS",
          },
          { status: 409 }
        )
      }

      const mismatchedContext = pairRows.some(
        (row) =>
          row.subject_id !== subjectId ||
          row.week_number !== weekNumber ||
          normalizeSessionDateKey(row.session_date) !== sessionDate ||
          (row.subject_day_material_id ?? null) !== (materialId ?? null)
      )
      if (mismatchedContext) {
        return badRequest("Audio pair must belong to the same material and session")
      }

      const existingRoleRow = pairRows.find((row) => row.pair_role === pairRole) ?? null
      if (!existingRoleRow && pairRows.length >= 2) {
        return badRequest("Audio pair already completed")
      }
    }

    let transcriptText = "Transcripcion pendiente."
    try {
      const downloadedFile = isR2ObjectKey(driveFile.id)
        ? await downloadR2Object(driveFile.id)
        : await downloadDriveFile(driveFile.id)

      try {
        transcriptText = await transcribeAudioWithGemini({
          audioBuffer: downloadedFile.buffer,
          mimeType: downloadedFile.mimeType || driveFile.mimeType,
        })
      } catch (error) {
        console.error("Gemini transcription failed, keeping pending placeholder:", error)
      }
    } catch (error) {
      console.error("Audio download failed before transcription, keeping pending placeholder:", error)
    }

    let rows: EntryRow[]
    try {
      if (pairId && pairRole) {
        const pairRows = await sql`
          SELECT id, drive_file_id, pair_role
          FROM subject_day_entries
          WHERE pair_id = ${pairId}
          ORDER BY id ASC
        ` as Array<{ id: number; drive_file_id: string; pair_role: "question" | "answer" | null }>

        const existingRoleRow = pairRows.find((row) => row.pair_role === pairRole) ?? null
        if (existingRoleRow) {
          rows = await sql`
            UPDATE subject_day_entries
            SET
              transcript_text = ${transcriptText},
              drive_file_id = ${driveFile.id},
              drive_file_name = ${uploadedFileName || driveFile.name},
              drive_mime_type = ${driveFile.mimeType},
              drive_web_view_link = ${("webViewLink" in driveFile && driveFile.webViewLink) || ""},
              updated_at = NOW()
            WHERE id = ${existingRoleRow.id}
            RETURNING id, subject_day_material_id, subject_id, week_number, session_date, weekday_index, order_index, transcript_text, drive_file_id, drive_file_name, drive_mime_type, drive_web_view_link, answer_text, custom_title, practice_state, pair_id, pair_role, FALSE AS is_featured, created_at, updated_at
          ` as EntryRow[]

          if (existingRoleRow.drive_file_id && existingRoleRow.drive_file_id !== driveFile.id) {
            try {
              if (isR2ObjectKey(existingRoleRow.drive_file_id)) {
                await deleteR2Object(existingRoleRow.drive_file_id)
              } else {
                await deleteDriveFile(existingRoleRow.drive_file_id)
              }
            } catch (cleanupError) {
              console.error("Failed to cleanup previous audio file after pair update:", cleanupError)
            }
          }
        } else {
          rows = await sql`
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
              pair_id,
              pair_role
            )
            VALUES (
              ${subjectId},
              ${materialId},
              ${weekNumber},
              ${sessionDate},
              ${weekdayIndex},
              ${nextOrderIndex},
              ${transcriptText},
              ${driveFile.id},
              ${uploadedFileName || driveFile.name},
              ${driveFile.mimeType},
              ${("webViewLink" in driveFile && driveFile.webViewLink) || ""},
              ${pairId},
              ${pairRole}
            )
            RETURNING id, subject_day_material_id, subject_id, week_number, session_date, weekday_index, order_index, transcript_text, drive_file_id, drive_file_name, drive_mime_type, drive_web_view_link, answer_text, custom_title, practice_state, pair_id, pair_role, FALSE AS is_featured, created_at, updated_at
          ` as EntryRow[]
        }
      } else {
        rows = await sql`
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
            pair_id,
            pair_role
          )
          VALUES (
            ${subjectId},
            ${materialId},
            ${weekNumber},
            ${sessionDate},
            ${weekdayIndex},
            ${nextOrderIndex},
            ${transcriptText},
            ${driveFile.id},
            ${uploadedFileName || driveFile.name},
            ${driveFile.mimeType},
            ${("webViewLink" in driveFile && driveFile.webViewLink) || ""},
            ${pairId},
            ${pairRole}
          )
          RETURNING id, subject_day_material_id, subject_id, week_number, session_date, weekday_index, order_index, transcript_text, drive_file_id, drive_file_name, drive_mime_type, drive_web_view_link, answer_text, custom_title, practice_state, pair_id, pair_role, FALSE AS is_featured, created_at, updated_at
        ` as EntryRow[]
      }
    } catch (error) {
      if (pairId && pairRole && isMissingPairColumns(error)) {
        return NextResponse.json(
          {
            error:
              "No se puede guardar la dupla de audio porque falta aplicar scripts/016-add-subject-day-entry-audio-pairs.sql en Neon.",
            code: "MISSING_AUDIO_PAIR_COLUMNS",
          },
          { status: 409 }
        )
      }

      if (!isMissingColumn(error)) throw error

      rows = await sql`
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
          drive_web_view_link
        )
        VALUES (
          ${subjectId},
          ${weekNumber},
          ${sessionDate},
          ${weekdayIndex},
          ${nextOrderIndex},
          ${transcriptText},
          ${driveFile.id},
          ${uploadedFileName || driveFile.name},
          ${driveFile.mimeType},
          ${("webViewLink" in driveFile && driveFile.webViewLink) || ""}
        )
        RETURNING id, NULL::INTEGER AS subject_day_material_id, subject_id, week_number, session_date, weekday_index, order_index, transcript_text, drive_file_id, drive_file_name, drive_mime_type, drive_web_view_link, answer_text, NULL::TEXT AS custom_title, NULL::TEXT AS practice_state, NULL::TEXT AS pair_id, NULL::TEXT AS pair_role, FALSE AS is_featured, created_at, updated_at
      ` as EntryRow[]
    }

    return NextResponse.json(formatEntry(rows[0] as EntryRow))
  } catch (error) {
    console.error("POST /api/subject-day-entries/complete error:", error)
    if (isMissingSubjectDayEntriesTable(error)) {
      return NextResponse.json(
        { error: "Falta crear la tabla subject_day_entries. Ejecuta scripts/005-create-subject-day-entries.sql y scripts/006-add-subject-day-entry-metadata.sql en Neon." },
        { status: 503 }
      )
    }
    const message = error instanceof Error ? error.message : "Failed to complete entry upload"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
