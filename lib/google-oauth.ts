const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file"

function requireEnv(name: string) {
  const value = process.env[name]
  if (!value) {
    throw new Error(`Missing environment variable: ${name}`)
  }

  return value
}

export function getGoogleOAuthConfig() {
  return {
    clientId: requireEnv("GOOGLE_OAUTH_CLIENT_ID"),
    clientSecret: requireEnv("GOOGLE_OAUTH_CLIENT_SECRET"),
    redirectUri: requireEnv("GOOGLE_OAUTH_REDIRECT_URI"),
    refreshToken: process.env.GOOGLE_DRIVE_REFRESH_TOKEN || "",
    scope: DRIVE_SCOPE,
  }
}

export async function exchangeCodeForRefreshToken(code: string) {
  const { clientId, clientSecret, redirectUri } = getGoogleOAuthConfig()

  const response = await fetch(GOOGLE_TOKEN_URL, {
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

  const payload = await response.json()
  if (!response.ok) {
    throw new Error(payload.error_description || payload.error || "Failed to exchange authorization code")
  }

  return payload as {
    access_token: string
    expires_in: number
    refresh_token?: string
    scope: string
    token_type: string
  }
}

export async function getGoogleAccessToken() {
  const { clientId, clientSecret, refreshToken } = getGoogleOAuthConfig()
  if (!refreshToken) {
    throw new Error("Missing environment variable: GOOGLE_DRIVE_REFRESH_TOKEN")
  }

  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  })

  const payload = await response.json()
  if (!response.ok || !payload.access_token) {
    throw new Error(payload.error_description || payload.error || "Failed to refresh Google access token")
  }

  return payload.access_token as string
}
