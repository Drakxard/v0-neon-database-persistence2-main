import { NextResponse } from "next/server"

import { ensureSubjectAccess, requireAuthSession } from "@/lib/authz"
import {
  createSubjectMaterialContainer,
  listSubjectMaterialContainers,
} from "@/lib/material-containers"

export const runtime = "nodejs"

function containerError(error: unknown) {
  const message = error instanceof Error ? error.message : ""
  if (message === "CONTAINER_NAME_REQUIRED") return NextResponse.json({ error: "El nombre es obligatorio." }, { status: 400 })
  if (message === "CONTAINER_NAME_CONFLICT") return NextResponse.json({ error: "Ya existe un contenedor con ese nombre." }, { status: 409 })
  return null
}

export async function GET(request: Request) {
  try {
    const auth = await requireAuthSession()
    if (auth.response) return auth.response
    const subjectId = String(new URL(request.url).searchParams.get("subjectId") || "").trim()
    if (!subjectId) return NextResponse.json({ error: "Missing subjectId" }, { status: 400 })
    const forbidden = ensureSubjectAccess(auth.session!, subjectId)
    if (forbidden) return forbidden
    return NextResponse.json(await listSubjectMaterialContainers(subjectId))
  } catch (error) {
    console.error("GET subject material containers error:", error)
    return NextResponse.json({ error: "No se pudieron cargar los contenedores. Verifica la migración 030." }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const auth = await requireAuthSession()
    if (auth.response) return auth.response
    const body = await request.json()
    const subjectId = String(body?.subjectId || "").trim()
    if (!subjectId) return NextResponse.json({ error: "Missing subjectId" }, { status: 400 })
    const forbidden = ensureSubjectAccess(auth.session!, subjectId)
    if (forbidden) return forbidden
    return NextResponse.json(await createSubjectMaterialContainer(subjectId, String(body?.name || "")))
  } catch (error) {
    const response = containerError(error)
    if (response) return response
    console.error("POST subject material container error:", error)
    return NextResponse.json({ error: "No se pudo crear el contenedor." }, { status: 500 })
  }
}
