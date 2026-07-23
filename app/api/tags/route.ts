import { NextResponse } from "next/server"

import { ensureSubjectAccess, requireAuthSession } from "@/lib/authz"
import { createMaterialTag, listMaterialTagWorkspace } from "@/lib/material-tags"
import { isLocalStorageMode } from "@/lib/storage-mode"

export const runtime = "nodejs"

function blockedLocalApi() {
  return NextResponse.json(
    { error: "Endpoint de tags deshabilitado en servidor local. Usa el workspace desde el navegador." },
    { status: 501 }
  )
}

function tagError(error: unknown) {
  const message = error instanceof Error ? error.message : ""
  if (message === "TAG_NAME_REQUIRED") {
    return NextResponse.json({ error: "El tag necesita un nombre." }, { status: 400 })
  }
  if (message === "TAG_PARENT_NOT_FOUND") {
    return NextResponse.json({ error: "El tag padre no existe." }, { status: 404 })
  }
  return null
}

export async function GET(request: Request) {
  try {
    if (isLocalStorageMode()) return blockedLocalApi()
    const auth = await requireAuthSession()
    if (auth.response) return auth.response

    const { searchParams } = new URL(request.url)
    const subjectId = String(searchParams.get("subjectId") || "").trim()
    if (!subjectId) {
      return NextResponse.json({ error: "Missing subjectId" }, { status: 400 })
    }
    const forbidden = ensureSubjectAccess(auth.session!, subjectId)
    if (forbidden) return forbidden

    const weekNumber = Number.parseInt(String(searchParams.get("weekNumber") || ""), 10)
    const sessionDate = String(searchParams.get("sessionDate") || "").trim()
    return NextResponse.json(
      await listMaterialTagWorkspace({
        subjectId,
        weekNumber: Number.isInteger(weekNumber) ? weekNumber : undefined,
        sessionDate: sessionDate || undefined,
      })
    )
  } catch (error) {
    console.error("GET /api/tags error:", error)
    return NextResponse.json({ error: "No se pudieron cargar los tags. Verifica la migracion 029." }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    if (isLocalStorageMode()) return blockedLocalApi()
    const auth = await requireAuthSession()
    if (auth.response) return auth.response
    const body = await request.json()
    return NextResponse.json(
      await createMaterialTag({
        name: String(body?.name || ""),
        color: typeof body?.color === "string" ? body.color : undefined,
        parentId: body?.parentId == null ? null : Number(body.parentId),
      })
    )
  } catch (error) {
    const response = tagError(error)
    if (response) return response
    console.error("POST /api/tags error:", error)
    return NextResponse.json({ error: "No se pudo crear el tag." }, { status: 500 })
  }
}
