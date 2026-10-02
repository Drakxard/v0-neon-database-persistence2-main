import { requireAuthSession } from "@/lib/authz"
import { parseSynthesisContext } from "@/lib/synthesis-context"
import { decideSynthesisVoiceDestination, validateVoiceTree, type EvaluateChoice } from "@/lib/synthesis-voice-navigation"

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
    const apiKey = process.env.gatewayia?.trim()
    if (!apiKey) {
      console.error("[Síntesis voz] Falta configurar gatewayia en el servidor.")
      return Response.json({ error: "Gateway no configurado." }, { status: 503 })
    }

    const evaluate: EvaluateChoice = async (state, criteria) => {
      const response = await fetch("https://ai-gateway.vercel.sh/v1/evaluate", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "typesafe-ai/jev",
          state,
          questions: {
            destination: {
              type: "choice",
              instructions: "Selecciona el nodo de Síntesis al que la persona quiere navegar. Prefiere el tema más específico que coincida con su frase. Elige none si no se menciona ninguno.",
              criteria,
            },
          },
        }),
        signal: AbortSignal.timeout(25_000),
        cache: "no-store",
      })
      if (!response.ok) {
        const details = await response.text()
        console.error("[Síntesis voz] AI Gateway rechazó la evaluación de Jev", {
          status: response.status,
          response: details.slice(0, 2_000),
        })
        throw new GatewayEvaluationError(response.status)
      }
      const result = await response.json() as { answers?: { destination?: { choice?: unknown; probabilities?: unknown } } }
      if (!result.answers?.destination || typeof result.answers.destination !== "object") {
        console.error("[Síntesis voz] Respuesta inesperada de Jev", result)
        throw new Error("Respuesta inesperada de Jev.")
      }
      return result.answers.destination
    }
    const destination = await decideSynthesisVoiceDestination(transcript, nodes, currentNodeId, evaluate)
    return Response.json(destination, { headers: { "Cache-Control": "no-store" } })
  } catch (error) {
    console.error("[Síntesis voz] No se pudo resolver el comando de voz", error)
    const message = error instanceof Error ? error.message : "No se pudo interpretar el comando."
    if (message.includes("inválid") || message.includes("inválido")) return Response.json({ error: message }, { status: 400 })
    return Response.json({
      error: "No se pudo consultar Jev.",
      ...(error instanceof GatewayEvaluationError ? { upstreamStatus: error.upstreamStatus } : {}),
    }, { status: 502 })
  }
}
