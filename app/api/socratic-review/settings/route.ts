import { NextResponse } from "next/server"

import { requireAuthSession } from "@/lib/authz"
import {
  getSocraticReviewSettings,
  isMissingSocraticReviewTable,
  updateSocraticReviewSettings,
} from "@/lib/socratic-review"

export const runtime = "nodejs"

function badRequest(message: string) {
  return NextResponse.json({ error: message }, { status: 400 })
}

export async function GET() {
  try {
    const auth = await requireAuthSession()
    if (auth.response) return auth.response

    return NextResponse.json(await getSocraticReviewSettings(auth.session!.email))
  } catch (error) {
    console.error("GET /api/socratic-review/settings error:", error)
    if (isMissingSocraticReviewTable(error)) {
      return NextResponse.json(
        { error: "Falta crear la tabla user_socratic_review_settings. Ejecuta scripts/024-create-user-socratic-review-settings.sql en Neon." },
        { status: 503 }
      )
    }

    return NextResponse.json({ error: "No se pudo cargar la configuracion socratica." }, { status: 500 })
  }
}

export async function PUT(request: Request) {
  try {
    const auth = await requireAuthSession()
    if (auth.response) return auth.response

    const body = await request.json().catch(() => null)
    const selectedModel = typeof body?.selectedModel === "string" ? body.selectedModel.trim() : ""
    if (!selectedModel) {
      return badRequest("Missing selectedModel")
    }

    return NextResponse.json(
      await updateSocraticReviewSettings({
        email: auth.session!.email,
        selectedModel,
      })
    )
  } catch (error) {
    console.error("PUT /api/socratic-review/settings error:", error)
    if (error instanceof Error && error.message === "MODEL_ID_INVALID") {
      return NextResponse.json({ error: "El modelo elegido ya no esta disponible en Groq." }, { status: 409 })
    }
    if (error instanceof Error && error.message === "Missing GROQ_API_KEY") {
      return NextResponse.json(
        { error: "Falta configurar GROQ_API_KEY para guardar la seleccion de modelo." },
        { status: 503 }
      )
    }
    if (isMissingSocraticReviewTable(error)) {
      return NextResponse.json(
        { error: "Falta crear la tabla user_socratic_review_settings. Ejecuta scripts/024-create-user-socratic-review-settings.sql en Neon." },
        { status: 503 }
      )
    }

    return NextResponse.json({ error: "No se pudo guardar la configuracion socratica." }, { status: 500 })
  }
}
