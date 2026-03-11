import { exchangeCodeForRefreshToken } from "@/lib/google-oauth"

export const runtime = "nodejs"

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const code = searchParams.get("code")
  const error = searchParams.get("error")

  if (error) {
    return new Response(`<html><body><h1>OAuth cancelado</h1><p>${error}</p></body></html>`, {
      headers: { "Content-Type": "text/html; charset=utf-8" },
      status: 400,
    })
  }

  if (!code) {
    return new Response(`<html><body><h1>Falta el code de Google OAuth.</h1></body></html>`, {
      headers: { "Content-Type": "text/html; charset=utf-8" },
      status: 400,
    })
  }

  try {
    const token = await exchangeCodeForRefreshToken(code)
    return new Response(
      `<html><body style="font-family: sans-serif; padding: 24px;"><h1>OAuth completado</h1><p>Copia este refresh token a <code>GOOGLE_DRIVE_REFRESH_TOKEN</code>.</p><pre style="white-space: pre-wrap; word-break: break-word; background: #f5f5f5; padding: 16px;">${token.refresh_token || "Google no devolvio refresh_token. Repeti el flujo con prompt=consent."}</pre></body></html>`,
      {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      }
    )
  } catch (oauthError) {
    const message = oauthError instanceof Error ? oauthError.message : "OAuth exchange failed"
    return new Response(`<html><body><h1>Error OAuth</h1><pre>${message}</pre></body></html>`, {
      headers: { "Content-Type": "text/html; charset=utf-8" },
      status: 500,
    })
  }
}
