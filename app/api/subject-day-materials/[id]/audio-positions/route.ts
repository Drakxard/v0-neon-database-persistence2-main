import { NextResponse } from "next/server"
import { getLegacyDatabase } from "@/lib/db"
import { requireSql } from "@/lib/db"
import { ensureSubjectAccess, requireAuthSession } from "@/lib/authz"
import { findLocalMaterialById, readEntryManifest, saveEntryManifest } from "@/lib/local-r2-manifests"
import { isLocalStorageMode } from "@/lib/storage-mode"

export const runtime = "nodejs"

const sql = getLegacyDatabase()

type RouteContext = {
  params: Promise<{
    id: string
  }>
}

type PositionRow = {
  entry_id: number
  subject_day_material_id: number
  page_num: number
  xp: number
  yp: number
  transcript_text: string
  custom_title: string | null
  drive_file_name: string
  drive_mime_type: string
  pair_id: string | null
  pair_role: "question" | "answer" | null
}

function isMissingPositionsTable(error: unknown) {
  return (
    error instanceof Error &&
    (error.message.includes("subject_day_entry_pdf_positions") || error.message.includes("relation") || error.message.includes("does not exist"))
  )
}

function isMissingEntriesTable(error: unknown) {
  return error instanceof Error && error.message.includes("subject_day_entries")
}

function isMissingPairColumns(error: unknown) {
  return Boolean(
    error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "42703"
  )
}

function normalizeRow(row: PositionRow) {
  return {
    entryId: row.entry_id,
    materialId: row.subject_day_material_id,
    pageNum: row.page_num,
    xp: Number(row.xp),
    yp: Number(row.yp),
    transcriptText: row.transcript_text,
    title: row.custom_title?.trim() || row.drive_file_name || "Audio",
    audioUrl: `/api/subject-day-entries/${row.entry_id}/audio`,
    mimeType: row.drive_mime_type || "audio/webm",
    pairId: row.pair_id,
    pairRole: row.pair_role,
  }
}

export async function GET(_request: Request, context: RouteContext) {
  try {
    const auth = await requireAuthSession()
    if (auth.response) return auth.response

    const { id } = await context.params
    const materialId = Number.parseInt(id, 10)

    if (!Number.isInteger(materialId)) {
      return NextResponse.json({ error: "Invalid material id" }, { status: 400 })
    }

    if (isLocalStorageMode()) {
      const material = await findLocalMaterialById(materialId)
      if (!material) {
        return NextResponse.json({ error: "Material not found" }, { status: 404 })
      }

      const forbidden = ensureSubjectAccess(auth.session!, material.subject_id)
      if (forbidden) return forbidden

      const manifest = await readEntryManifest(material.subject_id, material.week_number)
      const positions = manifest.entries
        .filter((entry) => entry.subject_day_material_id === materialId && entry.audio_position)
        .map((entry) => ({
          entryId: entry.id,
          materialId,
          pageNum: entry.audio_position!.page_num,
          xp: entry.audio_position!.xp,
          yp: entry.audio_position!.yp,
          transcriptText: entry.transcript_text,
          title: entry.custom_title?.trim() || entry.drive_file_name || "Audio",
          audioUrl: `/api/subject-day-entries/${entry.id}/audio`,
          mimeType: entry.drive_mime_type || "audio/webm",
          pairId: entry.pair_id,
          pairRole: entry.pair_role,
        }))
      return NextResponse.json(positions)
    }

    const scopeRows = await requireSql(sql)`
      SELECT subject_id
      FROM subject_day_materials
      WHERE id = ${materialId}
      LIMIT 1
    ` as Array<{ subject_id: string }>
    if (!scopeRows[0]) {
      return NextResponse.json({ error: "Material not found" }, { status: 404 })
    }

    const forbidden = ensureSubjectAccess(auth.session!, scopeRows[0].subject_id)
    if (forbidden) return forbidden

    let rows: PositionRow[]
    try {
      rows = await requireSql(sql)`
        SELECT
          positions.entry_id,
          positions.subject_day_material_id,
          positions.page_num,
          positions.xp,
          positions.yp,
          entries.transcript_text,
          entries.custom_title,
          entries.drive_file_name,
          entries.drive_mime_type,
          entries.pair_id,
          entries.pair_role
        FROM subject_day_entry_pdf_positions AS positions
        INNER JOIN subject_day_entries AS entries
          ON entries.id = positions.entry_id
        WHERE positions.subject_day_material_id = ${materialId}
        ORDER BY entries.order_index ASC, entries.id ASC
      ` as PositionRow[]
    } catch (error) {
      if (!isMissingPairColumns(error)) throw error

      rows = await requireSql(sql)`
        SELECT
          positions.entry_id,
          positions.subject_day_material_id,
          positions.page_num,
          positions.xp,
          positions.yp,
          entries.transcript_text,
          entries.custom_title,
          entries.drive_file_name,
          entries.drive_mime_type,
          NULL::TEXT AS pair_id,
          NULL::TEXT AS pair_role
        FROM subject_day_entry_pdf_positions AS positions
        INNER JOIN subject_day_entries AS entries
          ON entries.id = positions.entry_id
        WHERE positions.subject_day_material_id = ${materialId}
        ORDER BY entries.order_index ASC, entries.id ASC
      ` as PositionRow[]
    }

    return NextResponse.json(rows.map(normalizeRow))
  } catch (error) {
    console.error("GET /api/subject-day-materials/[id]/audio-positions error:", error)
    if (isMissingPositionsTable(error) || isMissingEntriesTable(error)) {
      return NextResponse.json(
        { error: "Falta crear la tabla subject_day_entry_pdf_positions. Ejecuta scripts/010-create-subject-day-entry-pdf-positions.sql en Neon." },
        { status: 503 }
      )
    }
    const message = error instanceof Error ? error.message : "Failed to fetch audio positions"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function POST(request: Request, context: RouteContext) {
  try {
    const auth = await requireAuthSession()
    if (auth.response) return auth.response

    const { id } = await context.params
    const materialId = Number.parseInt(id, 10)

    if (!Number.isInteger(materialId)) {
      return NextResponse.json({ error: "Invalid material id" }, { status: 400 })
    }

    if (isLocalStorageMode()) {
      const material = await findLocalMaterialById(materialId)
      if (!material) {
        return NextResponse.json({ error: "Material not found" }, { status: 404 })
      }

      const forbidden = ensureSubjectAccess(auth.session!, material.subject_id)
      if (forbidden) return forbidden

      const body = await request.json().catch(() => null)
      const entryId = Number.parseInt(String(body?.entryId ?? ""), 10)
      const pageNum = Number.parseInt(String(body?.pageNum ?? ""), 10)
      const xp = Number(body?.xp)
      const yp = Number(body?.yp)

      if (!Number.isInteger(entryId) || !Number.isInteger(pageNum) || pageNum < 1) {
        return NextResponse.json({ error: "Invalid entry position payload" }, { status: 400 })
      }

      if (!Number.isFinite(xp) || !Number.isFinite(yp) || xp < 0 || xp > 1 || yp < 0 || yp > 1) {
        return NextResponse.json({ error: "Invalid entry position coordinates" }, { status: 400 })
      }

      const manifest = await readEntryManifest(material.subject_id, material.week_number)
      const entry = manifest.entries.find((candidate) => candidate.id === entryId && candidate.subject_day_material_id === materialId)
      if (!entry) {
        return NextResponse.json({ error: "Entry does not belong to this material" }, { status: 400 })
      }

      const updatedEntry = {
        ...entry,
        updated_at: new Date().toISOString(),
        audio_position: {
          page_num: pageNum,
          xp,
          yp,
        },
      }
      await saveEntryManifest(
        material.subject_id,
        material.week_number,
        manifest.entries.map((candidate) => (candidate.id === entryId ? updatedEntry : candidate))
      )

      return NextResponse.json({
        entryId: updatedEntry.id,
        materialId,
        pageNum,
        xp,
        yp,
        transcriptText: updatedEntry.transcript_text,
        title: updatedEntry.custom_title?.trim() || updatedEntry.drive_file_name || "Audio",
        audioUrl: `/api/subject-day-entries/${updatedEntry.id}/audio`,
        mimeType: updatedEntry.drive_mime_type || "audio/webm",
        pairId: updatedEntry.pair_id,
        pairRole: updatedEntry.pair_role,
      })
    }

    const scopeRows = await requireSql(sql)`
      SELECT subject_id
      FROM subject_day_materials
      WHERE id = ${materialId}
      LIMIT 1
    ` as Array<{ subject_id: string }>
    if (!scopeRows[0]) {
      return NextResponse.json({ error: "Material not found" }, { status: 404 })
    }

    const forbidden = ensureSubjectAccess(auth.session!, scopeRows[0].subject_id)
    if (forbidden) return forbidden

    const body = await request.json().catch(() => null)
    const entryId = Number.parseInt(String(body?.entryId ?? ""), 10)
    const pageNum = Number.parseInt(String(body?.pageNum ?? ""), 10)
    const xp = Number(body?.xp)
    const yp = Number(body?.yp)

    if (!Number.isInteger(entryId) || !Number.isInteger(pageNum) || pageNum < 1) {
      return NextResponse.json({ error: "Invalid entry position payload" }, { status: 400 })
    }

    if (!Number.isFinite(xp) || !Number.isFinite(yp) || xp < 0 || xp > 1 || yp < 0 || yp > 1) {
      return NextResponse.json({ error: "Invalid entry position coordinates" }, { status: 400 })
    }

    const entryRows = await requireSql(sql)`
      SELECT id
      FROM subject_day_entries
      WHERE id = ${entryId}
        AND subject_day_material_id = ${materialId}
      LIMIT 1
    ` as Array<{ id: number }>

    if (!entryRows[0]) {
      return NextResponse.json({ error: "Entry does not belong to this material" }, { status: 400 })
    }

    const rows = await requireSql(sql)`
      INSERT INTO subject_day_entry_pdf_positions (
        entry_id,
        subject_day_material_id,
        page_num,
        xp,
        yp
      )
      VALUES (
        ${entryId},
        ${materialId},
        ${pageNum},
        ${xp},
        ${yp}
      )
      ON CONFLICT (entry_id)
      DO UPDATE SET
        subject_day_material_id = EXCLUDED.subject_day_material_id,
        page_num = EXCLUDED.page_num,
        xp = EXCLUDED.xp,
        yp = EXCLUDED.yp,
        updated_at = NOW()
      RETURNING entry_id, subject_day_material_id, page_num, xp, yp
    ` as Array<{ entry_id: number; subject_day_material_id: number; page_num: number; xp: number; yp: number }>

    let joinedRows: PositionRow[]
    try {
      joinedRows = await requireSql(sql)`
        SELECT
          positions.entry_id,
          positions.subject_day_material_id,
          positions.page_num,
          positions.xp,
          positions.yp,
          entries.transcript_text,
          entries.custom_title,
          entries.drive_file_name,
          entries.drive_mime_type,
          entries.pair_id,
          entries.pair_role
        FROM subject_day_entry_pdf_positions AS positions
        INNER JOIN subject_day_entries AS entries
          ON entries.id = positions.entry_id
        WHERE positions.entry_id = ${rows[0].entry_id}
        LIMIT 1
      ` as PositionRow[]
    } catch (error) {
      if (!isMissingPairColumns(error)) throw error

      joinedRows = await requireSql(sql)`
        SELECT
          positions.entry_id,
          positions.subject_day_material_id,
          positions.page_num,
          positions.xp,
          positions.yp,
          entries.transcript_text,
          entries.custom_title,
          entries.drive_file_name,
          entries.drive_mime_type,
          NULL::TEXT AS pair_id,
          NULL::TEXT AS pair_role
        FROM subject_day_entry_pdf_positions AS positions
        INNER JOIN subject_day_entries AS entries
          ON entries.id = positions.entry_id
        WHERE positions.entry_id = ${rows[0].entry_id}
        LIMIT 1
      ` as PositionRow[]
    }

    return NextResponse.json(normalizeRow(joinedRows[0]))
  } catch (error) {
    console.error("POST /api/subject-day-materials/[id]/audio-positions error:", error)
    if (isMissingPositionsTable(error) || isMissingEntriesTable(error)) {
      return NextResponse.json(
        { error: "Falta crear la tabla subject_day_entry_pdf_positions. Ejecuta scripts/010-create-subject-day-entry-pdf-positions.sql en Neon." },
        { status: 503 }
      )
    }
    const message = error instanceof Error ? error.message : "Failed to save audio position"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
