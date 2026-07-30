import { NextResponse } from "next/server"

import { ensureSubjectAccess, requireAuthSession } from "@/lib/authz"
import {
  deleteSubjectMaterialContainer,
  getSubjectMaterialContainer,
  renameSubjectMaterialContainer,
} from "@/lib/material-containers"

export const runtime = "nodejs"

async function authorize(rawId: string) {
  const id = Number(rawId)
  if (!Number.isInteger(id)) return { response: NextResponse.json({ error: "Invalid id" }, { status: 400 }) }
  const auth = await requireAuthSession()
  if (auth.response) return { response: auth.response }
  const container = await getSubjectMaterialContainer(id)
  if (!container) return { response: NextResponse.json({ error: "Container not found" }, { status: 404 }) }
  const forbidden = ensureSubjectAccess(auth.session!, container.subjectId)
  if (forbidden) return { response: forbidden }
  return { id, container }
}

function errorResponse(error: unknown) {
  const message = error instanceof Error ? error.message : ""
  if (message === "CONTAINER_FIXED") return NextResponse.json({ error: "Teoría y Práctica son contenedores fijos." }, { status: 409 })
  if (message === "CONTAINER_NAME_REQUIRED") return NextResponse.json({ error: "El nombre es obligatorio." }, { status: 400 })
  if (message === "CONTAINER_NAME_CONFLICT") return NextResponse.json({ error: "Ya existe un contenedor con ese nombre." }, { status: 409 })
  return null
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const result = await authorize((await context.params).id)
    if (result.response) return result.response
    const body = await request.json()
    return NextResponse.json(await renameSubjectMaterialContainer(result.id!, String(body?.name || "")))
  } catch (error) {
    const response = errorResponse(error)
    if (response) return response
    return NextResponse.json({ error: "No se pudo renombrar el contenedor." }, { status: 500 })
  }
}

export async function DELETE(_: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const result = await authorize((await context.params).id)
    if (result.response) return result.response
    const deleted = await deleteSubjectMaterialContainer(result.id!)
    if (!deleted.deleted) {
      return NextResponse.json(
        { error: `El contenedor contiene ${deleted.materialCount} PDF${deleted.materialCount === 1 ? "" : "s"}.`, ...deleted },
        { status: 409 }
      )
    }
    return NextResponse.json(deleted)
  } catch (error) {
    const response = errorResponse(error)
    if (response) return response
    return NextResponse.json({ error: "No se pudo eliminar el contenedor." }, { status: 500 })
  }
}
