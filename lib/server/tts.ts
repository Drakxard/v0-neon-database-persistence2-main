import { validateTtsRequest } from "../tts-models.ts"

const MAX_AUDIO_BYTES = 64 * 1024 * 1024
export class TtsServiceError extends Error {
  status: number
  constructor(message: string, status = 502) { super(message); this.status = status }
}

export function azureTtsConfig(env: Record<string, string | undefined> = process.env) {
  const apiKey = env.apittshd?.trim()
  const endpoint = env.conexionttshd?.trim()
  if (!apiKey || !endpoint) throw new TtsServiceError("Falta configurar apittshd o conexionttshd en el servidor.", 503)
  let url: URL
  try { url = new URL(endpoint) } catch { throw new TtsServiceError("conexionttshd debe ser una URL válida de Azure.", 503) }
  if (url.protocol !== "https:" || !/\.(?:openai\.azure\.com|services\.ai\.azure\.com|cognitiveservices\.azure\.com)$/.test(url.hostname)
    || url.username || url.password || url.hash || (url.port && url.port !== "443")
    || Array.from(url.searchParams.keys()).some((key) => key !== "api-version")) {
    throw new TtsServiceError("conexionttshd debe ser un endpoint HTTPS de Azure, sin claves ni parámetros adicionales.", 503)
  }
  const path = url.pathname.replace(/\/+$/, "")
  const deploymentPath = path.match(/^\/openai\/deployments\/([^/]+)(?:\/audio\/speech)?$/)
  const deployment = env.AZURE_TTS_HD_DEPLOYMENT?.trim() || (deploymentPath ? decodeURIComponent(deploymentPath[1]) : "tts-hd")
  if (/^\/(?:api\/projects\/[^/]+\/)?openai\/v1(?:\/audio\/speech)?$/.test(path)) {
    url.pathname = path.endsWith("/audio/speech") ? path : `${path}/audio/speech`
  } else if (!path || path === "/openai" || deploymentPath) {
    url.pathname = `/openai/deployments/${encodeURIComponent(deployment)}/audio/speech`
    if (!url.searchParams.has("api-version")) url.searchParams.set("api-version", "2025-04-01-preview")
  } else throw new TtsServiceError("conexionttshd debe ser el endpoint del recurso de Azure o la URL de audio/speech de su despliegue.", 503)
  return { apiKey, url: url.toString(), deployment }
}

async function readAudio(response: Response) {
  if (!response.body) throw new TtsServiceError("El proveedor devolvió un audio vacío.")
  const contentType = response.headers.get("content-type")?.split(";")[0] ?? "audio/mpeg"
  if (!contentType.startsWith("audio/") && contentType !== "application/octet-stream") throw new TtsServiceError("El proveedor devolvió un archivo que no es audio.")
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
  } catch (error) { await reader.cancel().catch(() => {}); throw error }
  finally { reader.releaseLock() }
  if (!size) throw new TtsServiceError("El proveedor devolvió un audio vacío.")
  return { audio: Buffer.concat(chunks), contentType: contentType === "application/octet-stream" ? "audio/mpeg" : contentType }
}

export async function generateTts(value: unknown, requestSignal?: AbortSignal, fetcher: typeof fetch = fetch) {
  const { model, voiceId, text } = validateTtsRequest(value)
  const signal = requestSignal ? AbortSignal.any([requestSignal, AbortSignal.timeout(60_000)]) : AbortSignal.timeout(60_000)
  let url: string
  let headers: Record<string, string>
  let body: Record<string, unknown>
  if (model.family === "azure") {
    const config = azureTtsConfig()
    url = config.url
    headers = { "api-key": config.apiKey, "Content-Type": "application/json" }
    body = { model: config.deployment, input: text, voice: voiceId, response_format: "mp3", speed: 1 }
  } else {
    const apiKey = process.env.gatewayia?.trim()
    if (!apiKey) throw new TtsServiceError("Falta configurar gatewayia en el servidor.", 503)
    // https://vercel.com/docs/ai-gateway/modalities/text-to-speech
    url = "https://ai-gateway.vercel.sh/v4/ai/speech-model"
    headers = {
      Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json",
      "ai-gateway-protocol-version": "0.0.1", "ai-speech-model-specification-version": "4", "ai-model-id": model.id,
    }
    body = { text, voice: voiceId, outputFormat: "mp3", language: "es-MX" }
  }
  const response = await fetcher(url, { method: "POST", headers, body: JSON.stringify(body), signal, cache: "no-store", redirect: "error" })
  if (!response.ok) {
    const provider = model.family === "azure" ? "Azure" : "Vercel AI Gateway"
    const hint = response.status === 401 || response.status === 403 ? " Revisá la clave y los permisos del proveedor."
      : response.status === 402 ? " Revisá el saldo y si este modelo admite tus créditos gratuitos."
      : response.status === 404 && model.family === "azure" ? " Revisá conexionttshd y el nombre del despliegue (AZURE_TTS_HD_DEPLOYMENT)."
      : response.status === 429 ? " Se alcanzó el límite de uso; intentá más tarde." : ""
    throw new TtsServiceError(`${provider} no pudo generar el audio (HTTP ${response.status}).${hint}`)
  }
  if (model.family === "azure") return readAudio(response)
  const payload = await response.json()
  const audio = payload?.audio
  if (typeof audio !== "string" || !audio || audio.length > Math.ceil(MAX_AUDIO_BYTES * 4 / 3) || !/^[A-Za-z0-9+/]+={0,2}$/.test(audio)) throw new TtsServiceError("Vercel AI Gateway devolvió un audio inválido.")
  const bytes = Buffer.from(audio, "base64")
  if (!bytes.length) throw new TtsServiceError("Vercel AI Gateway devolvió un audio vacío.")
  return { audio: bytes, contentType: "audio/mpeg" }
}
