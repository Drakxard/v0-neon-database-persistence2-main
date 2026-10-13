import { createAzure } from "@ai-sdk/azure"

export function azureExplanationConfig(env: Record<string, string | undefined> = process.env) {
  const apiKey = env.gpt5mini?.trim() || env.AZURE_OPENAI_API_KEY?.trim()
  if (!apiKey) return null
  const endpoint = env.conexiongpt5mini?.trim() || env.AZURE_OPENAI_ENDPOINT?.trim()
  if (!endpoint) throw new Error("Falta conexiongpt5mini: copiá el punto de conexión de Azure en las variables del servidor.")
  let url: URL
  try { url = new URL(endpoint) } catch { throw new Error("conexiongpt5mini debe ser una URL válida de Azure.") }
  if (url.protocol !== "https:" || !/\.(?:openai\.azure\.com|services\.ai\.azure\.com|cognitiveservices\.azure\.com)$/.test(url.hostname)
    || url.username || url.password || url.search || url.hash) throw new Error("conexiongpt5mini debe ser un punto de conexión HTTPS de Azure, sin claves ni parámetros.")
  const path = url.pathname.replace(/\/+$/, "")
  if (path && !/^\/openai(?:\/v1)?$/.test(path) && !/^\/api\/projects\/[^/]+(?:\/openai(?:\/v1)?)?$/.test(path)) {
    throw new Error("Copiá el punto de conexión del recurso o del proyecto de Azure, sin /responses ni /chat/completions.")
  }
  url.pathname = path.endsWith("/openai/v1") ? path : path.endsWith("/openai") ? `${path}/v1` : `${path}/openai/v1`
  return { apiKey, baseURL: url.toString().replace(/\/$/, ""), deployment: env.AZURE_OPENAI_DEPLOYMENT?.trim() || "gpt-5-mini" }
}

export function azureExplanationModel(config: NonNullable<ReturnType<typeof azureExplanationConfig>>) {
  return createAzure({ apiKey: config.apiKey, baseURL: config.baseURL }).responses(config.deployment)
}
