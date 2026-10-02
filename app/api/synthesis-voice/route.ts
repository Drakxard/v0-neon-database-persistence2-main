import { requireAuthSession } from "@/lib/authz"
import { parseSynthesisContext } from "@/lib/synthesis-context"
import { decideSynthesisVoiceDestination, validateVoiceTree, type EvaluateChoices } from "@/lib/synthesis-voice-navigation"
import { summarizeGatewayFailure } from "@/lib/jev-gateway-diagnostics"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
class GatewayEvaluationError extends Error {
  constructor(readonly upstreamStatus: number) {
    super(`AI Gateway respondió con HTTP ${upstreamStatus}.`)
  }
}

export async function POST(request: Request) {
  const auth = await requireAuthSession()
  if (auth.response) return auth.response
  try {
    if (Number(request.headers.get("content-length") || 0) > 250_000) {
      return Response.json({ error: "Solicitud demasiado grande." }, { status: 413 })
    }
    const body = await request.json()
    const context = parseSynthesisContext(body?.subjectId, body?.weekNumber)
    if (!auth.session?.isAdmin && !auth.session?.allowedSubjectIds.includes(context.subjectId)) {
      return Response.json({ error: "Materia no autorizada." }, { status: 403 })
    }
    const transcript = typeof body?.transcript === "string" ? body.transcript.trim() : ""
    if (!transcript || transcript.length > 300) return Response.json({ error: "Comando de voz inválido." }, { status: 400 })
    const nodes = validateVoiceTree(body?.nodes)
    const currentNodeId = typeof body?.currentNodeId === "string" && nodes.some((node) => node.id === body.currentNodeId)
      ? body.currentNodeId : null
    const lastEditedNodeId = typeof body?.lastEditedNodeId === "string" && nodes.some((node) => node.id === body.lastEditedNodeId)
      ? body.lastEditedNodeId : null
    const apiKey = process.env.gatewayia?.trim()
    const oidcToken = process.env.VERCEL_OIDC_TOKEN?.trim()
    const credentials = [
      ...(apiKey ? [{ name: "gatewayia", token: apiKey }] : []),
      ...(oidcToken && oidcToken !== apiKey ? [{ name: "Vercel OIDC", token: oidcToken }] : []),
    ]
    if (!credentials.length) {
      console.error("[Síntesis voz] Falta gatewayia y no hay token OIDC de Vercel.")
      return Response.json({ error: "Falta configurar una clave de AI Gateway en el servidor." }, { status: 503 })
    }

    const evaluate: EvaluateChoices = async (state, questions) => {
      const requestBody = JSON.stringify({
        model: "typesafe-ai/jev",
        state,
        questions,
        ...(process.env.JEV_PREFER_TYPESAFE_AI === "true"
          ? { providerOptions: { gateway: { order: ["typesafe-ai"] } } } : {}),
      })
      for (const [index, credential] of credentials.entries()) {
        const response = await fetch("https://ai-gateway.vercel.sh/v1/evaluate", {
          method: "POST",
          headers: { Authorization: `Bearer ${credential.token}`, "Content-Type": "application/json" },
          body: requestBody,
          signal: AbortSignal.timeout(25_000),
          cache: "no-store",
        })
        if (!response.ok) {
          const details = await response.text()
          console.error("[Síntesis voz] AI Gateway rechazó la evaluación de Jev", {
            credential: credential.name,
            ...summarizeGatewayFailure(response, details, credentials.map(({ token }) => token)),
          })
          if ((response.status === 401 || response.status === 403) && index < credentials.length - 1) continue
          throw new GatewayEvaluationError(response.status)
        }
        const result = await response.json() as { answers?: Record<string, { choice?: unknown; probabilities?: unknown }> }
        if (!result.answers || Object.keys(questions).some((key) => !result.answers?.[key]
          || typeof result.answers[key] !== "object")) {
          console.error("[Síntesis voz] Respuesta inesperada de Jev", result)
          throw new Error("Respuesta inesperada de Jev.")
        }
        return result.answers
      }
      throw new Error("No hay credenciales de AI Gateway disponibles.")
    }
    const destination = await decideSynthesisVoiceDestination(transcript, nodes, currentNodeId, lastEditedNodeId, evaluate)
    return Response.json(destination, { headers: { "Cache-Control": "no-store" } })
  } catch (error) {
    if (!(error instanceof GatewayEvaluationError)) console.error("[Síntesis voz] No se pudo resolver el comando de voz", error)
    const message = error instanceof Error ? error.message : "No se pudo interpretar el comando."
    if (message.includes("inválid") || message.includes("inválido")) return Response.json({ error: message }, { status: 400 })
    return Response.json({
      error: error instanceof GatewayEvaluationError && error.upstreamStatus === 403
        ? "AI Gateway rechazó el acceso a Jev (403). Revisá el acceso de la cuenta a ese modelo."
        : error instanceof GatewayEvaluationError && error.upstreamStatus === 401
          ? "AI Gateway rechazó la credencial configurada (401)."
          : "No se pudo consultar Jev.",
      ...(error instanceof GatewayEvaluationError ? { upstreamStatus: error.upstreamStatus } : {}),
    }, { status: error instanceof GatewayEvaluationError && error.upstreamStatus === 403 ? 503 : 502 })
  }
}
