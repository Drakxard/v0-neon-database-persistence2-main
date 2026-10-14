import { requireAuthSession } from "@/lib/authz"
import { TtsInputError } from "@/lib/tts-models"
import { generateTts, TtsServiceError } from "@/lib/server/tts"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 60

export async function POST(request: Request) {
  const auth = await requireAuthSession()
  if (auth.response) return auth.response
  try {
    const value = await request.json().catch(() => { throw new TtsInputError("La solicitud no es válida.") })
    const { audio, contentType } = await generateTts(value, request.signal)
    return new Response(new Uint8Array(audio), { headers: { "Content-Type": contentType, "Cache-Control": "no-store" } })
  } catch (error) {
    const status = error instanceof TtsInputError ? 400 : error instanceof TtsServiceError ? error.status : 502
    const message = error instanceof TtsInputError || error instanceof TtsServiceError ? error.message : "No se pudo generar el audio. Intentá nuevamente."
    return Response.json({ error: message }, { status, headers: { "Cache-Control": "no-store" } })
  }
}
