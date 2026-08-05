import { requireAuthSession } from "@/lib/authz"
import { requireGroqClient } from "@/lib/groq-models"
import { buildPdfTranslationPrompt, PDF_TRANSLATION_MODEL } from "@/lib/pdf-translation"
import { withInscreenUserConfig } from "@/lib/inscreen-user-config"

export const runtime = "nodejs"

async function translate(request: Request) {
  try {
    const auth = await requireAuthSession()
    if (auth.response) return auth.response

    const body = await request.json()
    const prompt = buildPdfTranslationPrompt(
      typeof body?.text === "string" ? body.text : "",
      typeof body?.promptTemplate === "string" ? body.promptTemplate : ""
    )
    const groq = requireGroqClient()
    const completion = await groq.chat.completions.create({
      model: PDF_TRANSLATION_MODEL,
      messages: [{ role: "user", content: prompt }],
      temperature: 0.1,
      max_completion_tokens: 4096,
      stream: false,
    })
    const translation = completion.choices[0]?.message?.content?.trim() || ""
    if (!translation) {
      return Response.json({ error: "Groq no devolvio una traduccion." }, { status: 502 })
    }
    return Response.json({ translation })
  } catch (error) {
    const message = error instanceof Error ? error.message : ""
    if (message === "TRANSLATION_TEXT_REQUIRED") {
      return Response.json({ error: "Selecciona texto para traducir." }, { status: 400 })
    }
    if (message === "TRANSLATION_TOKEN_REQUIRED") {
      return Response.json({ error: "El prompt debe incluir {texto}." }, { status: 400 })
    }
    if (message === "Missing GROQ_API_KEY") {
      return Response.json({ error: "GROQ_API_KEY no esta configurada." }, { status: 503 })
    }
    console.error("POST /api/pdf-translate error:", error)
    return Response.json({ error: message || "No se pudo traducir el texto." }, { status: 502 })
  }
}

export async function POST(request: Request) {
  return withInscreenUserConfig(request, () => translate(request))
}
