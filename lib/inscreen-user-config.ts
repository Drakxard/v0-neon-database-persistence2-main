import { AsyncLocalStorage } from "node:async_hooks"
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto"

export const INSCREEN_CONFIG_COOKIE = "inscreen_config_b"
export const INSCREEN_CONFIG_HALF_HEADER = "x-inscreen-config-half"

export type InscreenUserConfig = {
  GROQ_API_KEY: string
  MARKER_API: string
  R2_BUCKET_NAME: string
  R2_ACCESS_KEY_ID: string
  R2_SECRET_ACCESS_KEY: string
  R2_ENDPOINT: string
}

export type InscreenR2Config = Pick<
  InscreenUserConfig,
  "R2_BUCKET_NAME" | "R2_ACCESS_KEY_ID" | "R2_SECRET_ACCESS_KEY" | "R2_ENDPOINT"
>

const runtimeConfig = new AsyncLocalStorage<InscreenUserConfig>()
const CONFIG_FIELDS = [
  "GROQ_API_KEY",
  "MARKER_API",
  "R2_BUCKET_NAME",
  "R2_ACCESS_KEY_ID",
  "R2_SECRET_ACCESS_KEY",
  "R2_ENDPOINT",
] as const

function getSeed() {
  const seed = String(process.env.INSCREEN_CONFIG_SEED || "").trim()
  if (seed.length < 32) throw new Error("INSCREEN_CONFIG_SEED debe tener al menos 32 caracteres.")
  return createHash("sha256").update(seed).digest()
}

export function normalizeInscreenUserConfig(value: unknown): InscreenUserConfig {
  const input = value && typeof value === "object" ? value as Record<string, unknown> : {}
  const config = Object.fromEntries(CONFIG_FIELDS.map((field) => [field, String(input[field] || "").trim()])) as InscreenUserConfig
  const r2Fields = [config.R2_BUCKET_NAME, config.R2_ACCESS_KEY_ID, config.R2_SECRET_ACCESS_KEY, config.R2_ENDPOINT]
  if (r2Fields.some(Boolean) && !r2Fields.every(Boolean)) throw new Error("Completa todos los campos de Cloudflare R2.")
  if (config.R2_ENDPOINT) {
    const endpoint = new URL(config.R2_ENDPOINT)
    if (
      endpoint.protocol !== "https:" || endpoint.username || endpoint.password || endpoint.port ||
      endpoint.pathname !== "/" || endpoint.search || endpoint.hash ||
      !/^[a-z0-9]{32}(?:\.(?:eu|fedramp))?\.r2\.cloudflarestorage\.com$/i.test(endpoint.hostname)
    ) throw new Error("R2_ENDPOINT debe ser un endpoint S3 oficial de Cloudflare R2.")
    if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(config.R2_BUCKET_NAME)) throw new Error("R2_BUCKET_NAME invalido.")
  }
  for (const field of CONFIG_FIELDS) {
    if (Buffer.byteLength(config[field], "utf8") > 4096) throw new Error(`${field} es demasiado largo.`)
  }
  return config
}

export function getInscreenR2Config(config: InscreenUserConfig): InscreenR2Config {
  return {
    R2_BUCKET_NAME: config.R2_BUCKET_NAME,
    R2_ACCESS_KEY_ID: config.R2_ACCESS_KEY_ID,
    R2_SECRET_ACCESS_KEY: config.R2_SECRET_ACCESS_KEY,
    R2_ENDPOINT: config.R2_ENDPOINT,
  }
}

export function sealInscreenUserConfig(value: unknown) {
  const config = normalizeInscreenUserConfig(value)
  const iv = randomBytes(12)
  const cipher = createCipheriv("aes-256-gcm", getSeed(), iv)
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(config), "utf8"), cipher.final()])
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), ciphertext.toString("base64url")].join(".")
}

export function openInscreenUserConfig(token: string) {
  const [version, ivValue, tagValue, ciphertextValue] = String(token || "").split(".")
  if (version !== "v1" || !ivValue || !tagValue || !ciphertextValue) throw new Error("Configuracion InScreen invalida.")
  try {
    const decipher = createDecipheriv("aes-256-gcm", getSeed(), Buffer.from(ivValue, "base64url"))
    decipher.setAuthTag(Buffer.from(tagValue, "base64url"))
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(ciphertextValue, "base64url")),
      decipher.final(),
    ]).toString("utf8")
    return normalizeInscreenUserConfig(JSON.parse(plaintext))
  } catch {
    throw new Error("No se pudo desbloquear User.InScreen con la semilla de este despliegue.")
  }
}

export function splitInscreenUserConfig(value: unknown) {
  const sealedConfig = sealInscreenUserConfig(value)
  const midpoint = Math.ceil(sealedConfig.length / 2)
  return {
    fileHalf: sealedConfig.slice(0, midpoint),
    cookieHalf: sealedConfig.slice(midpoint),
  }
}

function readCookie(request: Request, name: string) {
  const cookieHeader = request.headers.get("cookie") || ""
  for (const part of cookieHeader.split(";")) {
    const [key, ...rest] = part.trim().split("=")
    if (key === name) return decodeURIComponent(rest.join("="))
  }
  return ""
}

export function readInscreenUserConfig(request: Request) {
  const fileHalf = String(request.headers.get(INSCREEN_CONFIG_HALF_HEADER) || "").trim()
  const cookieHalf = readCookie(request, INSCREEN_CONFIG_COOKIE)
  if (!fileHalf || !cookieHalf) throw new Error("Falta una mitad de la configuracion InScreen.")
  return openInscreenUserConfig(`${fileHalf}${cookieHalf}`)
}

export function openInscreenUserConfigParts(fileHalf: string, request: Request) {
  const normalizedFileHalf = String(fileHalf || "").trim()
  const cookieHalf = readCookie(request, INSCREEN_CONFIG_COOKIE)
  if (!normalizedFileHalf || !cookieHalf) throw new Error("Falta una mitad de la configuracion InScreen.")
  return openInscreenUserConfig(`${normalizedFileHalf}${cookieHalf}`)
}

export async function withInscreenUserConfig(request: Request, handler: () => Promise<Response>) {
  try {
    const config = readInscreenUserConfig(request)
    return await runtimeConfig.run(config, handler)
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Configuracion InScreen requerida.", configurationRequired: true },
      { status: 428 }
    )
  }
}

export function withInscreenRuntimeConfig<T>(config: InscreenUserConfig | InscreenR2Config, handler: () => T) {
  return runtimeConfig.run({
    GROQ_API_KEY: "",
    MARKER_API: "",
    ...config,
  }, handler)
}

export function getInscreenRuntimeSecret(name: keyof InscreenUserConfig) {
  return runtimeConfig.getStore()?.[name] || ""
}

export function buildInscreenConfigCookie(cookieHalf: string) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : ""
  return `${INSCREEN_CONFIG_COOKIE}=${encodeURIComponent(cookieHalf)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=31536000${secure}`
}
