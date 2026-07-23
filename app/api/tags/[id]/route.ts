import { NextResponse } from "next/server"

import { requireAuthSession } from "@/lib/authz"
import { deleteMaterialTag, updateMaterialTag } from "@/lib/material-tags"
import { isLocalStorageMode } from "@/lib/storage-mode"

export const runtime = "nodejs"

function errorResponse(error: unknown) {
  const message = error instanceof Error ? error.message : ""
  if (message === "TAG_NAME_REQUIRED") return NextResponse.json({ error: "El tag necesita un nombre." }, { status: 400 })
  if (message === "TAG_NAME_CONFLICT") return NextResponse.json({ error: "Ya existe un tag con ese nombre.", code: message }, { status: 409 })
  if (message === "TAG_PARENT_CYCLE") return NextResponse.json({ error: "La jerarquia produciria un ciclo.", code: message }, { status: 409 })
  if (message === "TAG_PARENT_NOT_FOUND") return NextResponse.json({ error: "El tag padre no existe." }, { status: 404 })
  return null
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    if (isLocalStorageMode()) return NextResponse.json({ error: "Usa el workspace local." }, { status: 501 })
    const auth = await requireAuthSession()
    if (auth.response) return auth.response
    const tagId = Number.parseInt((await context.params).id, 10)
    if (!Number.isInteger(tagId)) return NextResponse.json({ error: "Invalid tag id" }, { status: 400 })
    const body = await request.json()
    const tag = await updateMaterialTag(tagId, {
      name: typeof body?.name === "string" ? body.name : undefined,
      color: typeof body?.color === "string" ? body.color : undefined,
      parentId: "parentId" in body ? (body.parentId == null ? null : Number(body.parentId)) : undefined,
    })
    return tag ? NextResponse.json(tag) : NextResponse.json({ error: "Tag not found" }, { status: 404 })
  } catch (error) {
    const response = errorResponse(error)
    if (response) return response
    console.error("PATCH /api/tags/[id] error:", error)
    return NextResponse.json({ error: "No se pudo actualizar el tag." }, { status: 500 })
  }
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    if (isLocalStorageMode()) return NextResponse.json({ error: "Usa el workspace local." }, { status: 501 })
    const auth = await requireAuthSession()
    if (auth.response) return auth.response
    const tagId = Number.parseInt((await context.params).id, 10)
    if (!Number.isInteger(tagId)) return NextResponse.json({ error: "Invalid tag id" }, { status: 400 })
    const force = new URL(request.url).searchParams.get("force") === "1"
    const result = await deleteMaterialTag(tagId, force)
    if (result.missing) return NextResponse.json({ error: "Tag not found" }, { status: 404 })
    if (!result.deleted) {
      return NextResponse.json(
        { error: "El tag tiene materiales asignados.", usageCount: result.usageCount },
        { status: 409 }
      )
    }
    return NextResponse.json(result)
  } catch (error) {
    console.error("DELETE /api/tags/[id] error:", error)
    return NextResponse.json({ error: "No se pudo eliminar el tag." }, { status: 500 })
  }
}
