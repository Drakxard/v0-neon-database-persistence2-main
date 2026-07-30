import { NextResponse } from "next/server"

import { ensureSubjectAccess, requireAuthSession } from "@/lib/authz"
import { getMaterialSubjectId } from "@/lib/material-tags"
import {
  listMaterialTagRegions,
  normalizeMaterialTagRegions,
  replaceMaterialTagRegions,
} from "@/lib/material-tag-regions"

export const runtime = "nodejs"

async function authorize(id: string, tagId: string) {
  const materialId = Number(id)
  const parsedTagId = Number(tagId)
  if (!Number.isInteger(materialId) || !Number.isInteger(parsedTagId)) {
    return { response: NextResponse.json({ error: "Invalid id" }, { status: 400 }) }
  }
  const auth = await requireAuthSession()
  if (auth.response) return { response: auth.response }
  const subjectId = await getMaterialSubjectId(materialId)
  if (!subjectId) return { response: NextResponse.json({ error: "Material not found" }, { status: 404 }) }
  const forbidden = ensureSubjectAccess(auth.session!, subjectId)
  if (forbidden) return { response: forbidden }
  return { materialId, tagId: parsedTagId }
}

export async function GET(_: Request, context: { params: Promise<{ id: string; tagId: string }> }) {
  try {
    const params = await context.params
    const result = await authorize(params.id, params.tagId)
    if (result.response) return result.response
    return NextResponse.json(await listMaterialTagRegions(result.materialId!, result.tagId!))
  } catch (error) {
    console.error("GET material tag regions error:", error)
    return NextResponse.json({ error: "No se pudieron cargar las regiones." }, { status: 500 })
  }
}

export async function PUT(request: Request, context: { params: Promise<{ id: string; tagId: string }> }) {
  try {
    const params = await context.params
    const result = await authorize(params.id, params.tagId)
    if (result.response) return result.response
    const body = await request.json()
    const regions = normalizeMaterialTagRegions(result.materialId!, result.tagId!, body?.regions)
    return NextResponse.json(await replaceMaterialTagRegions(result.materialId!, result.tagId!, regions))
  } catch (error) {
    const message = error instanceof Error ? error.message : ""
    if (message === "REGIONS_INVALID") {
      return NextResponse.json({ error: "Las coordenadas no son válidas." }, { status: 400 })
    }
    if (message === "TAG_ASSIGNMENT_NOT_FOUND") {
      return NextResponse.json({ error: "El tag no está asignado a este material." }, { status: 409 })
    }
    console.error("PUT material tag regions error:", error)
    return NextResponse.json({ error: "No se pudieron guardar las regiones." }, { status: 500 })
  }
}
