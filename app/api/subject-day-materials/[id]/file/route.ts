import { neon } from "@neondatabase/serverless"
import { requireSql } from "@/lib/db"

import { ensureSubjectAccess, requireAuthSession } from "@/lib/authz"
import { findLocalMaterialById } from "@/lib/local-r2-manifests"
import { downloadR2Object } from "@/lib/r2"
import { isLocalStorageMode } from "@/lib/storage-mode"
import { downloadSubjectDayMaterialFileOrAutocleanup } from "@/lib/subject-day-materials-storage"

export const runtime = "nodejs"

const sql = process.env.DATABASE_URL ? neon(process.env.DATABASE_URL) : null

function isMissingSubjectDayMaterialsTable(error: unknown) {
  return Boolean(
    error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "42P01"
  )
}

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireAuthSession()
    if (auth.response) return auth.response

    const { id } = await context.params
    const materialId = Number.parseInt(id, 10)
    if (!Number.isInteger(materialId)) {
      return Response.json({ error: "Invalid material id" }, { status: 400 })
    }

    if (isLocalStorageMode()) {
      const material = await findLocalMaterialById(materialId)
      if (!material) {
        return Response.json({ error: "Material not found" }, { status: 404 })
      }

      const forbidden = ensureSubjectAccess(auth.session!, material.subject_id)
      if (forbidden) return forbidden

      const remoteFile = await downloadR2Object(material.drive_file_id)
      return new Response(remoteFile.buffer, {
        headers: {
          "Content-Type": remoteFile.mimeType || material.drive_mime_type || "application/pdf",
          "Content-Disposition": `inline; filename="${material.file_name}"`,
          "Cache-Control": "private, max-age=0, must-revalidate",
        },
      })
    }

    const rows = await requireSql(sql)`
      SELECT drive_file_id, file_name, drive_mime_type, subject_id
      FROM subject_day_materials
      WHERE id = ${materialId}
      LIMIT 1
    `
    const material = rows[0]
    if (!material) {
      return Response.json({ error: "Material not found" }, { status: 404 })
    }

    const forbidden = ensureSubjectAccess(auth.session!, String(material.subject_id || ""))
    if (forbidden) return forbidden

    const fileResult = await downloadSubjectDayMaterialFileOrAutocleanup({
      id: materialId,
      drive_file_id: material.drive_file_id,
    })

    if (fileResult.status === "missing") {
      return Response.json({ error: "El archivo remoto ya no existe." }, { status: 404 })
    }

    if (fileResult.status === "unavailable") {
      const message =
        fileResult.error instanceof Error ? fileResult.error.message : "No se pudo acceder al archivo remoto."
      return Response.json({ error: message }, { status: 500 })
    }

    return new Response(fileResult.value.buffer, {
      headers: {
        "Content-Type": fileResult.value.mimeType || material.drive_mime_type || "application/pdf",
        "Content-Disposition": `inline; filename="${material.file_name}"`,
        "Cache-Control": "private, max-age=0, must-revalidate",
      },
    })
  } catch (error) {
    console.error("GET /api/subject-day-materials/[id]/file error:", error)
    if (isMissingSubjectDayMaterialsTable(error)) {
      return Response.json(
        { error: "Falta crear la tabla subject_day_materials. Ejecuta scripts/008-create-subject-day-materials.sql en Neon." },
        { status: 503 }
      )
    }

    const message = error instanceof Error ? error.message : "Failed to stream file"
    return Response.json({ error: message }, { status: 500 })
  }
}
