import { neon } from "@neondatabase/serverless"
import { NextResponse } from "next/server"

import { ensureSubjectAccess, requireAuthSession } from "@/lib/authz"
import { deleteLocalMaterial, findLocalMaterialById, upsertLocalMaterial } from "@/lib/local-r2-manifests"
import { deleteSubjectDayMaterialRemoteFile } from "@/lib/subject-day-materials-maintenance"
import { isLocalStorageMode } from "@/lib/storage-mode"
import { getWeekdayIndexFromDateKey, parseDateKey } from "@/lib/subject-utils"

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

function isMissingSubjectDayMaterialsTable(error: unknown) {
  return Boolean(
    error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "42P01"
  )
}

function normalizeSessionDateKey(sessionDate: string | Date) {
  if (sessionDate instanceof Date) {
    return `${sessionDate.getFullYear()}-${String(sessionDate.getMonth() + 1).padStart(2, "0")}-${String(sessionDate.getDate()).padStart(2, "0")}`
  }

  return sessionDate.includes("T") ? sessionDate.slice(0, 10) : sessionDate
}

function normalizeRow(row: SubjectDayMaterialRow | null) {
  if (!row) return null
  return {
    ...row,
    session_date: normalizeSessionDateKey(row.session_date),
  }
}

function parseMaterialPatchBody(body: unknown) {
  const payload = body && typeof body === "object" ? body as Record<string, unknown> : {}
  const patch: Partial<{
    fileName: string
    materialType: "theory" | "practice"
    sessionDate: string
    weekNumber: number
    isCheckupDone: boolean
  }> = {}

  if ("fileName" in payload) {
    const fileName = String(payload.fileName || "").trim()
    if (!fileName) return { error: "Invalid fileName" }
    patch.fileName = fileName
  }

  if ("materialType" in payload) {
    if (payload.materialType !== "theory" && payload.materialType !== "practice") {
      return { error: "Invalid materialType" }
    }
    patch.materialType = payload.materialType
  }

  if ("sessionDate" in payload) {
    const sessionDate = String(payload.sessionDate || "").trim()
    if (!/^\d{4}-\d{2}-\d{2}$/.test(sessionDate) || Number.isNaN(parseDateKey(sessionDate).getTime())) {
      return { error: "Invalid sessionDate" }
    }
    patch.sessionDate = sessionDate
  }

  if ("weekNumber" in payload) {
    const weekNumber = Number.parseInt(String(payload.weekNumber), 10)
    if (!Number.isInteger(weekNumber) || weekNumber < 0) {
      return { error: "Invalid weekNumber" }
    }
    patch.weekNumber = weekNumber
  }

  if ("isCheckupDone" in payload) {
    if (typeof payload.isCheckupDone !== "boolean") {
      return { error: "Invalid isCheckupDone value" }
    }
    patch.isCheckupDone = payload.isCheckupDone
  }

  if (Object.keys(patch).length === 0) return { error: "Missing patch fields" }
  return { patch }
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
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

      const parsed = parseMaterialPatchBody(await request.json())
      if ("error" in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 })
      const patch = parsed.patch

      const updatedMaterial = {
        ...material,
        file_name: patch.fileName ?? material.file_name,
        material_type: patch.materialType ?? material.material_type,
        session_date: patch.sessionDate ?? material.session_date,
        week_number: patch.weekNumber ?? material.week_number,
        weekday_index: getWeekdayIndexFromDateKey(patch.sessionDate ?? material.session_date),
        is_checkup_done: patch.isCheckupDone ?? material.is_checkup_done,
        updated_at: new Date().toISOString(),
      }

      await upsertLocalMaterial(updatedMaterial)
      return NextResponse.json(updatedMaterial)
    }

    if (!sql) {
      return NextResponse.json({ error: "DATABASE_URL is not configured" }, { status: 503 })
    }

    const scopeRows = await sql`
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

    const parsed = parseMaterialPatchBody(await request.json())
    if ("error" in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 })
    const patch = parsed.patch
    const currentRows = await sql`
      SELECT id, subject_id, week_number, session_date, weekday_index, material_type, order_index, file_name, drive_file_id, drive_mime_type, drive_web_view_link, is_checkup_done, created_at, updated_at
      FROM subject_day_materials
      WHERE id = ${materialId}
      LIMIT 1
    ` as SubjectDayMaterialRow[]
    const currentMaterial = currentRows[0]
    if (!currentMaterial) {
      return NextResponse.json({ error: "Material not found" }, { status: 404 })
    }
    const nextSessionDate = patch.sessionDate ?? normalizeSessionDateKey(currentMaterial.session_date)

    const rows = await sql`
      UPDATE subject_day_materials
      SET
        file_name = ${patch.fileName ?? currentMaterial.file_name},
        material_type = ${patch.materialType ?? currentMaterial.material_type},
        session_date = ${nextSessionDate},
        week_number = ${patch.weekNumber ?? currentMaterial.week_number},
        weekday_index = ${getWeekdayIndexFromDateKey(nextSessionDate)},
        is_checkup_done = ${patch.isCheckupDone ?? currentMaterial.is_checkup_done},
        updated_at = NOW()
      WHERE id = ${materialId}
      RETURNING id, subject_id, week_number, session_date, weekday_index, material_type, order_index, file_name, drive_file_id, drive_mime_type, drive_web_view_link, is_checkup_done, created_at, updated_at
    ` as SubjectDayMaterialRow[]

    if (!rows[0]) {
      return NextResponse.json({ error: "Material not found" }, { status: 404 })
    }

    return NextResponse.json(normalizeRow(rows[0] as SubjectDayMaterialRow))
  } catch (error) {
    console.error("PATCH /api/subject-day-materials/[id] error:", error)
    if (isMissingSubjectDayMaterialsTable(error)) {
      return NextResponse.json(
        { error: "Falta crear la tabla subject_day_materials. Ejecuta scripts/008-create-subject-day-materials.sql en Neon." },
        { status: 503 }
      )
    }
    return NextResponse.json({ error: "Failed to update material" }, { status: 500 })
  }
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
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

      await deleteLocalMaterial(materialId)

      if (material.drive_file_id) {
        await deleteSubjectDayMaterialRemoteFile({
          materialId,
          driveFileId: material.drive_file_id,
        })
      }

      return NextResponse.json({ success: true, id: material.id })
    }

    if (!sql) {
      return NextResponse.json({ error: "DATABASE_URL is not configured" }, { status: 503 })
    }

    const materials = await sql`
      SELECT id, drive_file_id, subject_id
      FROM subject_day_materials
      WHERE id = ${materialId}
    ` as Array<{ id: number; drive_file_id: string; subject_id: string }>

    const material = materials[0]
    if (!material) {
      return NextResponse.json({ error: "Material not found" }, { status: 404 })
    }

    const forbidden = ensureSubjectAccess(auth.session!, material.subject_id)
    if (forbidden) return forbidden

    if (material.drive_file_id) {
      await deleteSubjectDayMaterialRemoteFile({
        materialId,
        driveFileId: material.drive_file_id,
      })
    }

    const rows = await sql`
      DELETE FROM subject_day_materials
      WHERE id = ${materialId}
      RETURNING id
    ` as Array<{ id: number }>

    if (!rows[0]) {
      return NextResponse.json({ error: "Material not found" }, { status: 404 })
    }

    return NextResponse.json({ success: true, id: rows[0].id })
  } catch (error) {
    console.error("DELETE /api/subject-day-materials/[id] error:", error)
    if (isMissingSubjectDayMaterialsTable(error)) {
      return NextResponse.json(
        { error: "Falta crear la tabla subject_day_materials. Ejecuta scripts/008-create-subject-day-materials.sql en Neon." },
        { status: 503 }
      )
    }
    return NextResponse.json({ error: "Failed to delete material" }, { status: 500 })
  }
}
