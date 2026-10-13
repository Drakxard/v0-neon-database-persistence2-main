import { createGateway } from "@ai-sdk/gateway"
import { requireAuthSession } from "@/lib/authz"
import { explanationInput } from "@/lib/pdf-explanation"
import { explanationStream } from "@/lib/server/pdf-explanation-stream"

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
    return explanationStream(
      gateway(process.env.PDF_EXPLANATION_MODEL || "anthropic/claude-sonnet-4.5"),
      input.question,
      input.transcription,
    )
  } catch {
    return Response.json({ error: "No se pudo generar la explicación con AI Gateway. Volvé a intentarlo." }, { status: 502 })
  }
}
