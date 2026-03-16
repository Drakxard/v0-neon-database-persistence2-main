import { neon } from "@neondatabase/serverless"

import { downloadDriveFile } from "@/lib/google-drive"
import { downloadR2Object, isR2ObjectKey } from "@/lib/r2"

export const runtime = "nodejs"

const sql = neon(process.env.DATABASE_URL!)

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
    const { id } = await context.params
    const materialId = Number.parseInt(id, 10)
    if (!Number.isInteger(materialId)) {
      return Response.json({ error: "Invalid material id" }, { status: 400 })
    }

    const rows = await sql`
      SELECT drive_file_id, file_name, drive_mime_type
      FROM subject_day_materials
      WHERE id = ${materialId}
      LIMIT 1
    `
    const material = rows[0]
    if (!material) {
      return Response.json({ error: "Material not found" }, { status: 404 })
    }

    const file = isR2ObjectKey(material.drive_file_id)
      ? await downloadR2Object(material.drive_file_id)
      : await downloadDriveFile(material.drive_file_id)

    return new Response(file.buffer, {
      headers: {
        "Content-Type": file.mimeType || material.drive_mime_type || "application/pdf",
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
