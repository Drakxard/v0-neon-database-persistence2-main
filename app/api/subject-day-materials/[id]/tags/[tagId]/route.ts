import { NextResponse } from "next/server"

import { ensureSubjectAccess, requireAuthSession } from "@/lib/authz"
import {
  assignTagToMaterial,
  getMaterialSubjectId,
  unassignTagFromMaterial,
} from "@/lib/material-tags"
import { isLocalStorageMode } from "@/lib/storage-mode"

export const runtime = "nodejs"

async function authorize(context: { params: Promise<{ id: string; tagId: string }> }) {
  const auth = await requireAuthSession()
  if (auth.response) return { response: auth.response }
  const params = await context.params
  const materialId = Number.parseInt(params.id, 10)
  const tagId = Number.parseInt(params.tagId, 10)
  if (!Number.isInteger(materialId) || !Number.isInteger(tagId)) {
    return { response: NextResponse.json({ error: "Invalid id" }, { status: 400 }) }
  }
  const subjectId = await getMaterialSubjectId(materialId)
  if (!subjectId) return { response: NextResponse.json({ error: "Material not found" }, { status: 404 }) }
  const forbidden = ensureSubjectAccess(auth.session!, subjectId)
  if (forbidden) return { response: forbidden }
  return { materialId, tagId }
}

export async function PUT(_request: Request, context: { params: Promise<{ id: string; tagId: string }> }) {
  try {
    if (isLocalStorageMode()) return NextResponse.json({ error: "Usa el workspace local." }, { status: 501 })
    const result = await authorize(context)
    if (result.response) return result.response
    return NextResponse.json(await assignTagToMaterial(result.materialId!, result.tagId!))
  } catch (error) {
    console.error("PUT material tag error:", error)
    return NextResponse.json({ error: "No se pudo asignar el tag." }, { status: 500 })
  }
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string; tagId: string }> }) {
  try {
    if (isLocalStorageMode()) return NextResponse.json({ error: "Usa el workspace local." }, { status: 501 })
    const result = await authorize(context)
    if (result.response) return result.response
    return NextResponse.json(await unassignTagFromMaterial(result.materialId!, result.tagId!))
  } catch (error) {
    console.error("DELETE material tag error:", error)
    return NextResponse.json({ error: "No se pudo quitar el tag." }, { status: 500 })
  }
}
