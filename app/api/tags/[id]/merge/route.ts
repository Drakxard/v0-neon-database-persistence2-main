import { NextResponse } from "next/server"

import { requireAuthSession } from "@/lib/authz"
import { mergeMaterialTags } from "@/lib/material-tags"
import { isLocalStorageMode } from "@/lib/storage-mode"

export const runtime = "nodejs"

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    if (isLocalStorageMode()) return NextResponse.json({ error: "Usa el workspace local." }, { status: 501 })
    const auth = await requireAuthSession()
    if (auth.response) return auth.response
    const sourceTagId = Number.parseInt((await context.params).id, 10)
    const body = await request.json()
    const targetTagId = Number(body?.targetTagId)
    if (!Number.isInteger(sourceTagId) || !Number.isInteger(targetTagId)) {
      return NextResponse.json({ error: "Invalid tag id" }, { status: 400 })
    }
    const tag = await mergeMaterialTags(sourceTagId, targetTagId)
    return tag ? NextResponse.json(tag) : NextResponse.json({ error: "Tag not found" }, { status: 404 })
  } catch (error) {
    const message = error instanceof Error ? error.message : ""
    if (message === "TAG_MERGE_SAME" || message === "TAG_PARENT_CYCLE") {
      return NextResponse.json({ error: "La fusion solicitada no es valida.", code: message }, { status: 409 })
    }
    console.error("POST /api/tags/[id]/merge error:", error)
    return NextResponse.json({ error: "No se pudieron fusionar los tags." }, { status: 500 })
  }
}
