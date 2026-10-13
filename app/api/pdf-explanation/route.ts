import { createGateway } from "@ai-sdk/gateway"
import { requireAuthSession } from "@/lib/authz"
import { explanationInput } from "@/lib/pdf-explanation"
import { explanationStream } from "@/lib/server/pdf-explanation-stream"
import { explanationFailure } from "@/lib/pdf-explanation-errors"
import { freeExplanationModels, FreeExplanationModelsError } from "@/lib/server/pdf-explanation-models"

export const runtime = "nodejs"
export const maxDuration = 120

export async function POST(request: Request) {
  const auth = await requireAuthSession()
  if (auth.response) return auth.response
  let input: ReturnType<typeof explanationInput>
  try {
    if (Number(request.headers.get("content-length") || 0) > 800_000) {
      return Response.json({ error: "La página supera el límite permitido." }, { status: 413 })
    }
    input = explanationInput(await request.json())
  } catch {
    return Response.json({ error: "Ingresá una duda y una transcripción de página válidas." }, { status: 400 })
  }
  const apiKey = process.env.gatewayia?.trim() || process.env.AI_GATEWAY_API_KEY?.trim()
  if (!apiKey && !process.env.VERCEL_OIDC_TOKEN) {
    return Response.json({ error: "Falta configurar la clave de AI Gateway en el servidor." }, { status: 503 })
  }
  try {
    const gateway = createGateway({ ...(apiKey ? { apiKey } : {}) })
    const models = await freeExplanationModels(process.env.PDF_EXPLANATION_MODEL)
    return explanationStream(
      gateway(models[0].id),
      input.question,
      input.transcription,
      { fallbackModels: models.slice(1).map(model => model.id), maxOutputTokens: Math.min(...models.map(model => model.maxOutputTokens)) },
    )
  } catch (error) {
    if (error instanceof FreeExplanationModelsError) return Response.json({ error: error.message }, { status: 503 })
    const failure = explanationFailure(error)
    console.error("[PDF explicación] AI Gateway", failure.diagnostics)
    return Response.json({ error: failure.message }, { status: 502 })
  }
}
