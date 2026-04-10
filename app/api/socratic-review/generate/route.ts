import { NextResponse } from "next/server"

import { ensureSubjectAccess, requireAuthSession } from "@/lib/authz"
import {
  generateSocraticReviewTurn,
  getSocraticReviewPair,
  isMissingSocraticReviewTable,
} from "@/lib/socratic-review"

export const runtime = "nodejs"

function badRequest(message: string) {
  return NextResponse.json({ error: message }, { status: 400 })
}

export async function POST(request: Request) {
  try {
    const auth = await requireAuthSession()
    if (auth.response) return auth.response

    const body = await request.json().catch(() => null)
    const pairId = typeof body?.pairId === "string" ? body.pairId.trim() : ""
    const modelId = typeof body?.modelId === "string" ? body.modelId.trim() : ""
    if (!pairId) {
      return badRequest("Missing pairId")
    }
    if (!modelId) {
      return badRequest("Missing modelId")
    }

    const pair = await getSocraticReviewPair(pairId)
    if (!pair) {
      return NextResponse.json({ error: "No se encontro la dupla solicitada." }, { status: 404 })
    }

    const forbidden = ensureSubjectAccess(auth.session!, pair.subjectId)
    if (forbidden) return forbidden

    const generated = await generateSocraticReviewTurn({ pairId, modelId })

    return NextResponse.json(generated)
  } catch (error) {
    console.error("POST /api/socratic-review/generate error:", error)
    if (error instanceof Error && error.message === "MODEL_ID_INVALID") {
      return NextResponse.json({ error: "El modelo elegido ya no esta disponible en Groq." }, { status: 409 })
    }
    if (error instanceof Error && error.message === "Missing GROQ_API_KEY") {
      return NextResponse.json(
        { error: "Falta configurar GROQ_API_KEY para generar preguntas socraticas." },
        { status: 503 }
      )
    }
    if (error instanceof Error && error.message === "PAIR_NOT_ELIGIBLE") {
      return NextResponse.json({ error: "La dupla no tiene transcripcion util para este modo." }, { status: 409 })
    }
    if (isMissingSocraticReviewTable(error)) {
      return NextResponse.json(
        { error: "Faltan migraciones socraticas en Neon. Ejecuta scripts/023, 024 y 025." },
        { status: 503 }
      )
    }

    return NextResponse.json({ error: "No se pudieron generar las preguntas socraticas." }, { status: 500 })
  }
}
