import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from "node:crypto"

export const DRIVE_CONFIG_COOKIE = "drive_config_b"
export const DRIVE_CONFIG_HALF_HEADER = "x-drive-config-half"
export const DRIVE_OAUTH_STATE_COOKIE = "drive_oauth_state"

export type DriveUserConfig = {
  refreshToken: string
  rootFolderId: string
  rootFolderName: string
  rootFolderLink: string
  email: string
}

function key() {
  const seed = String(process.env.INSCREEN_CONFIG_SEED || "").trim()
  if (seed.length < 32) throw new Error("INSCREEN_CONFIG_SEED debe tener al menos 32 caracteres.")
  return createHash("sha256").update(`drive:${seed}`).digest()
}

function cookie(request: Request, name: string) {
  const header = request.headers.get("cookie") || ""
  for (const part of header.split(";")) {
    const [candidate, ...value] = part.trim().split("=")
    if (candidate === name) return decodeURIComponent(value.join("="))
  }
  return ""
}

function normalize(value: unknown): DriveUserConfig {
  const input = value && typeof value === "object" ? value as Record<string, unknown> : {}
  const config = {
    refreshToken: String(input.refreshToken || "").trim(),
    rootFolderId: String(input.rootFolderId || "").trim(),
    rootFolderName: String(input.rootFolderName || "Cursado2026").trim(),
    rootFolderLink: String(input.rootFolderLink || "").trim(),
    email: String(input.email || "").trim(),
  }
  if (!config.refreshToken || !config.rootFolderId || !config.email) throw new Error("Configuracion de Drive incompleta.")
  return config
}

function seal(value: DriveUserConfig) {
  const iv = randomBytes(12)
  const cipher = createCipheriv("aes-256-gcm", key(), iv)
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(normalize(value)), "utf8"), cipher.final()])
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), ciphertext.toString("base64url")].join(".")
}

function open(token: string) {
  const [version, iv, tag, ciphertext] = token.split(".")
  if (version !== "v1" || !iv || !tag || !ciphertext) throw new Error("Configuracion de Drive invalida.")
  try {
    const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64url"))
    decipher.setAuthTag(Buffer.from(tag, "base64url"))
    return normalize(JSON.parse(Buffer.concat([
      decipher.update(Buffer.from(ciphertext, "base64url")),
      decipher.final(),
    ]).toString("utf8")))
  } catch {
    throw new Error("No se pudo desbloquear User.Drive.")
  }
}

export function splitDriveUserConfig(config: DriveUserConfig) {
  const token = seal(config)
  const midpoint = Math.ceil(token.length / 2)
  return { fileHalf: token.slice(0, midpoint), cookieHalf: token.slice(midpoint) }
}

export function readDriveUserConfig(request: Request) {
  const fileHalf = String(request.headers.get(DRIVE_CONFIG_HALF_HEADER) || "").trim()
  const cookieHalf = cookie(request, DRIVE_CONFIG_COOKIE)
  if (!fileHalf || !cookieHalf) throw new Error("Google Drive no esta conectado.")
  return open(`${fileHalf}${cookieHalf}`)
}

export function driveConfigCookie(value: string, maxAge = 31536000) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : ""
  return `${DRIVE_CONFIG_COOKIE}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure}`
}

export function createOAuthState() {
  const nonce = randomBytes(24).toString("base64url")
  const signature = createHash("sha256").update(`${nonce}:${key().toString("base64url")}`).digest("base64url")
  return `${nonce}.${signature}`
}

export function verifyOAuthState(request: Request, state: string) {
  const stored = cookie(request, DRIVE_OAUTH_STATE_COOKIE)
  if (!stored || !state || stored.length !== state.length) return false
  return timingSafeEqual(Buffer.from(stored), Buffer.from(state))
}

export function oauthStateCookie(value: string, maxAge = 600) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : ""
  return `${DRIVE_OAUTH_STATE_COOKIE}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`
}
