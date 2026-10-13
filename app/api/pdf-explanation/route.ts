import { createGateway } from "@ai-sdk/gateway"
import { requireAuthSession } from "@/lib/authz"
import { explanationInput } from "@/lib/pdf-explanation"
import { explanationStream } from "@/lib/server/pdf-explanation-stream"
import { explanationFailure } from "@/lib/pdf-explanation-errors"
import { freeExplanationModels, FreeExplanationModelsError } from "@/lib/server/pdf-explanation-models"
import { azureExplanationConfig, azureExplanationModel } from "@/lib/server/pdf-explanation-azure"

export const runtime = "nodejs"
export const maxDuration = 300

export async function GET() {
  const auth = await requireAuthSession()
  if (auth.response) return auth.response
  try {
    const azure = azureExplanationConfig()
    if (azure) return Response.json({ provider: "azure", models: [{ id: azure.deployment, name: "GPT-5 mini · Azure" }] }, { headers: { "Cache-Control": "no-store" } })
    return Response.json({ models: await freeExplanationModels(process.env.PDF_EXPLANATION_MODEL) }, { headers: { "Cache-Control": "no-store" } })
  } catch (error) {
    if (process.env.gpt5mini || process.env.AZURE_OPENAI_API_KEY) return Response.json({ error: error instanceof Error ? error.message : "Revisá la configuración de Azure." }, { status: 503 })
    return Response.json({ error: error instanceof FreeExplanationModelsError ? error.message : "No se pudo cargar la lista de modelos gratuitos." }, { status: 503 })
  }
}

export async function POST(request: Request) {
  const auth = await requireAuthSession()
  if (auth.response) return auth.response
  let input: ReturnType<typeof explanationInput>
  let requestedModel: string | undefined
  try {
    if (Number(request.headers.get("content-length") || 0) > 5_000_000) {
      return Response.json({ error: "La página supera el límite permitido.", stage: "validacion-solicitud" }, { status: 413 })
    }
    const body = await request.json()
    input = explanationInput(body)
    if (body.model !== undefined && (typeof body.model !== "string" || !body.model.trim() || body.model.length > 200)) throw new Error("Modelo inválido")
    requestedModel = body.model?.trim()
  } catch {
    return Response.json({ error: "Ingresá una duda y una transcripción de página válidas.", stage: "validacion-solicitud" }, { status: 400 })
  }
  try {
    const azure = azureExplanationConfig()
    if (azure) return explanationStream(azureExplanationModel(azure), input.question, input.transcription,
      { maxOutputTokens: 12_000, reasoning: "low", provider: "azure", image: input.image })
  } catch (error) {
    const failure = explanationFailure(error, "azure")
    return Response.json({ error: error instanceof Error && !failure.diagnostics.status ? error.message : failure.message,
      stage: "configuracion-azure", diagnostics: failure.diagnostics }, { status: 503 })
  }
  const apiKey = process.env.gatewayia?.trim() || process.env.AI_GATEWAY_API_KEY?.trim()
  if (!apiKey && !process.env.VERCEL_OIDC_TOKEN) {
    return Response.json({ error: "Falta configurar la clave de AI Gateway en el servidor.", stage: "configuracion-gateway" }, { status: 503 })
  }
  try {
    const gateway = createGateway({ ...(apiKey ? { apiKey } : {}) })
    const models = await freeExplanationModels(process.env.PDF_EXPLANATION_MODEL)
    const selected = requestedModel ? models.find(model => model.id === requestedModel) : models[0]
    if (!selected) return Response.json({ error: "El modelo elegido ya no está disponible a precio cero. Actualizá la lista y elegí otro.", stage: "validacion-modelo-gratuito" }, { status: 400 })
    return explanationStream(
      gateway(selected.id),
      input.question,
      input.transcription,
      { maxOutputTokens: selected.maxOutputTokens, image: input.image },
    )
  } catch (error) {
    if (error instanceof FreeExplanationModelsError) return Response.json({ error: error.message, stage: "catalogo-modelos-gratuitos" }, { status: 503 })
    const failure = explanationFailure(error)
    console.error("[PDF explicación] AI Gateway", failure.diagnostics)
    return Response.json({ error: failure.message, stage: "solicitud-gateway", diagnostics: failure.diagnostics }, { status: 502 })
  }
}
