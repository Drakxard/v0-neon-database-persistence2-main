import { NextResponse } from "next/server"

import { requireAuthSession } from "@/lib/authz"
import { listSocraticReviewModels } from "@/lib/socratic-review"

export const runtime = "nodejs"

export async function GET() {
  try {
    const auth = await requireAuthSession()
    if (auth.response) return auth.response

    return NextResponse.json({
      models: await listSocraticReviewModels(),
    })
  } catch (error) {
    console.error("GET /api/groq/models error:", error)
    if (error instanceof Error && error.message === "Missing GROQ_API_KEY") {
      return NextResponse.json(
        { error: "Falta configurar GROQ_API_KEY para listar modelos de Groq." },
        { status: 503 }
      )
    }

    return NextResponse.json({ error: "No se pudieron cargar los modelos de Groq." }, { status: 500 })
  }
}
