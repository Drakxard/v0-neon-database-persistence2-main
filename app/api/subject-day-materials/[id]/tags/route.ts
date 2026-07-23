import { NextResponse } from "next/server"

import { ensureSubjectAccess, requireAuthSession } from "@/lib/authz"
import { getMaterialSubjectId, listTagsForMaterial } from "@/lib/material-tags"
import { isLocalStorageMode } from "@/lib/storage-mode"

export const runtime = "nodejs"

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    if (isLocalStorageMode()) return NextResponse.json({ error: "Usa el workspace local." }, { status: 501 })
    const auth = await requireAuthSession()
    if (auth.response) return auth.response
    const materialId = Number.parseInt((await context.params).id, 10)
    if (!Number.isInteger(materialId)) return NextResponse.json({ error: "Invalid material id" }, { status: 400 })
    const subjectId = await getMaterialSubjectId(materialId)
    if (!subjectId) return NextResponse.json({ error: "Material not found" }, { status: 404 })
    const forbidden = ensureSubjectAccess(auth.session!, subjectId)
    if (forbidden) return forbidden
    return NextResponse.json(await listTagsForMaterial(materialId))
  } catch (error) {
    console.error("GET /api/subject-day-materials/[id]/tags error:", error)
    return NextResponse.json({ error: "No se pudieron cargar los tags del material." }, { status: 500 })
  }
}
