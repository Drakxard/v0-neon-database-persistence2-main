const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
const GOOGLE_USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo"

export const APP_AUTH_COOKIE_NAME = "app_auth_session"
export const APP_AUTH_STATE_COOKIE_NAME = "app_auth_state"

function requireEnv(name: string) {
  const value = process.env[name]
  if (!value) {
    throw new Error(`Missing environment variable: ${name}`)
  }

  return value
}

export function getAppAuthConfig() {
  return {
    clientId: requireEnv("GOOGLE_OAUTH_CLIENT_ID"),
    clientSecret: requireEnv("GOOGLE_OAUTH_CLIENT_SECRET"),
    redirectUri: requireEnv("GOOGLE_AUTH_REDIRECT_URI"),
    allowedEmail: requireEnv("ALLOWED_GOOGLE_EMAIL").toLowerCase(),
    sessionSecret: requireEnv("APP_AUTH_SECRET"),
  }
}

function toBase64Url(input: Buffer | string) {
  const buffer = typeof input === "string" ? Buffer.from(input, "utf8") : input
  return buffer
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "")
}

function fromBase64Url(input: string) {
  const normalized = input.replace(/-/g, "+").replace(/_/g, "/")
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4)
  return Buffer.from(padded, "base64").toString("utf8")
}

async function signPayload(payload: string, secret: string) {
  const crypto = await import("node:crypto")
  return toBase64Url(crypto.createHmac("sha256", secret).update(payload).digest())
}

export async function createSessionToken(email: string, secret: string, expiresAtMs: number) {
  const payload = `${toBase64Url(email.toLowerCase())}.${expiresAtMs}`
  const signature = await signPayload(payload, secret)
  return `${payload}.${signature}`
}

export async function verifySessionToken(token: string, secret: string) {
  const parts = token.split(".")
  if (parts.length !== 3) return null

  const [encodedEmail, encodedExpiry, signature] = parts
  const payload = `${encodedEmail}.${encodedExpiry}`
  const expectedSignature = await signPayload(payload, secret)
  if (signature !== expectedSignature) return null

  const expiresAtMs = Number.parseInt(encodedExpiry, 10)
  if (!Number.isFinite(expiresAtMs) || Date.now() > expiresAtMs) return null

  const email = fromBase64Url(encodedEmail).toLowerCase()
  return { email, expiresAtMs }
}

export async function exchangeCodeForIdentity(code: string) {
  const { clientId, clientSecret, redirectUri } = getAppAuthConfig()

  const tokenResponse = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  })

  const tokenPayload = await tokenResponse.json()
  if (!tokenResponse.ok || !tokenPayload.access_token) {
    throw new Error(tokenPayload.error_description || tokenPayload.error || "Failed to exchange Google OAuth code")
  }

  const profileResponse = await fetch(GOOGLE_USERINFO_URL, {
    headers: {
      Authorization: `Bearer ${tokenPayload.access_token as string}`,
    },
    cache: "no-store",
  })

  const profilePayload = await profileResponse.json()
  if (!profileResponse.ok || typeof profilePayload.email !== "string") {
    throw new Error("Failed to fetch Google account email")
  }

  return {
    email: profilePayload.email.toLowerCase(),
    name: typeof profilePayload.name === "string" ? profilePayload.name : "",
  }
}
