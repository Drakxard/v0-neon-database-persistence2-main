import { NextResponse } from "next/server"

import { ensureSubjectAccess, requireAuthSession } from "@/lib/authz"
import {
  getSocraticReviewTurn,
  isMissingSocraticReviewTable,
  revealSocraticReviewTurn,
} from "@/lib/socratic-review"

function badRequest(message: string) {
  return NextResponse.json({ error: message }, { status: 400 })
}

export async function POST(request: Request) {
  try {
    const auth = await requireAuthSession()
    if (auth.response) return auth.response

    const body = await request.json().catch(() => null)
    const turnId = Number.parseInt(String(body?.turnId || ""), 10)
    if (!Number.isInteger(turnId)) {
      return badRequest("Invalid turnId")
    }

    const existingTurn = await getSocraticReviewTurn(turnId)
    if (!existingTurn) {
      return NextResponse.json({ error: "No se encontro el turno solicitado." }, { status: 404 })
    }

    const forbidden = ensureSubjectAccess(auth.session!, existingTurn.subject_id)
    if (forbidden) return forbidden

    const updated = await revealSocraticReviewTurn(turnId)
    if (!updated) {
      return NextResponse.json({ error: "No se encontro el turno solicitado." }, { status: 404 })
    }

    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error("POST /api/socratic-review/reveal error:", error)
    if (isMissingSocraticReviewTable(error)) {
      return NextResponse.json(
        { error: "Falta crear la tabla socratic_review_turns. Ejecuta scripts/023-create-socratic-review-turns.sql en Neon." },
        { status: 503 }
      )
    }

    return NextResponse.json({ error: "No se pudo registrar la revelacion de la respuesta." }, { status: 500 })
  }
}
