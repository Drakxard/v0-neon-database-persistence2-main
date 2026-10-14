import { getClefConfiguration } from "./cloudflare-clef.ts"
import { ttsInput, validateTtsRequest } from "../tts-models.ts"

const MAX_AUDIO_BYTES = 64 * 1024 * 1024
export class TtsServiceError extends Error {
  status: number
  constructor(message: string, status = 502) { super(message); this.status = status }
}

async function readAudio(response: Response, fallbackType: string) {
  if (!response.ok || !response.body) throw new TtsServiceError("No se pudo obtener el audio generado.")
  const contentType = response.headers.get("content-type")?.split(";")[0] ?? fallbackType
  if (!contentType.startsWith("audio/") && contentType !== "application/octet-stream") {
    throw new TtsServiceError("Cloudflare devolvió un archivo que no es audio.")
  }
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.length
      if (size > MAX_AUDIO_BYTES) throw new TtsServiceError("El audio generado es demasiado grande.")
      chunks.push(value)
    }
  } catch (error) {
    await reader.cancel().catch(() => {})
    throw error
  } finally { reader.releaseLock() }
  if (!size) throw new TtsServiceError("Cloudflare devolvió un audio vacío.")
  return { audio: Buffer.concat(chunks), contentType: contentType === "application/octet-stream" ? fallbackType : contentType }
}

export async function generateCloudflareTts(value: unknown, requestSignal?: AbortSignal, fetcher: typeof fetch = fetch) {
  const { model, voiceId, text } = validateTtsRequest(value)
  const config = getClefConfiguration()
  if (!config.configured) throw new TtsServiceError(`Falta configurar ${config.missing.join(" y ")}.`, 503)
  const signal = requestSignal ? AbortSignal.any([requestSignal, AbortSignal.timeout(60_000)]) : AbortSignal.timeout(60_000)
  const hosted = model.cloudflareId.startsWith("@cf/")
  const input = ttsInput(model, text, voiceId)
  const response = await fetcher(
    `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(config.accountId)}/ai/run${hosted ? `/${model.cloudflareId}` : ""}`,
    {
      method: "POST", signal, cache: "no-store",
      headers: { Authorization: `Bearer ${config.token}`, "Content-Type": "application/json" },
      body: JSON.stringify(hosted ? input : { model: model.cloudflareId, input }),
    }
  )
  if (!response.ok) {
    const hint = response.status === 401 || response.status === 403 ? " Revisá los permisos Workers AI del token."
      : response.status === 402 ? " Revisá los créditos de Unified Billing." : ""
    throw new TtsServiceError(`Cloudflare no pudo generar el audio (HTTP ${response.status}).${hint}`)
  }
  const mime = model.family === "gemini" ? "audio/wav" : "audio/mpeg"
  if (!response.headers.get("content-type")?.includes("json")) return readAudio(response, mime)
  const payload = await response.json()
  if (payload.success === false || (payload.state && payload.state !== "Completed")) {
    throw new TtsServiceError("Cloudflare no completó la generación del audio. Revisá el acceso al modelo y los créditos de la cuenta.")
  }
  const audio = payload.result?.audio ?? payload.audio
  if (typeof audio !== "string" || !audio) throw new TtsServiceError("Cloudflare devolvió una respuesta sin audio.")
  if (audio.startsWith("https://")) {
    const url = new URL(audio)
    // Cloudflare model responses use presigned R2 URLs. Never send the API
    // token to those URLs, follow redirects, or fetch arbitrary/private hosts.
    if (url.username || url.password || (url.port && url.port !== "443") || !(url.hostname.endsWith(".r2.dev") || url.hostname.endsWith(".r2.cloudflarestorage.com") || url.hostname === "examples.aig.cloudflare.com")) {
      throw new TtsServiceError("Cloudflare devolvió una ubicación de audio no admitida.")
    }
    return readAudio(await fetcher(url, { signal, cache: "no-store", redirect: "error" }), mime)
  }
  if (audio.length > Math.ceil(MAX_AUDIO_BYTES * 4 / 3) || !/^[A-Za-z0-9+/]+={0,2}$/.test(audio)) {
    throw new TtsServiceError("Cloudflare devolvió un audio inválido.")
  }
  const bytes = Buffer.from(audio, "base64")
  if (!bytes.length) throw new TtsServiceError("Cloudflare devolvió un audio vacío.")
  return { audio: bytes, contentType: mime }
}
