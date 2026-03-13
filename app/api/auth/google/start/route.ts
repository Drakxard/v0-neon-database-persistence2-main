import { NextResponse } from "next/server"

import { APP_AUTH_STATE_COOKIE_NAME, getAppAuthConfig } from "@/lib/app-auth"

export const runtime = "nodejs"

export async function GET(request: Request) {
  const { clientId, redirectUri } = getAppAuthConfig()
  const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth")
  const state = crypto.randomUUID()
  const next = new URL(request.url).searchParams.get("next") || "/"

  authUrl.searchParams.set("client_id", clientId)
  authUrl.searchParams.set("redirect_uri", redirectUri)
  authUrl.searchParams.set("response_type", "code")
  authUrl.searchParams.set("scope", "openid email profile")
  authUrl.searchParams.set("state", `${state}:${next}`)
  authUrl.searchParams.set("prompt", "select_account")

  const response = NextResponse.redirect(authUrl)
  response.cookies.set(APP_AUTH_STATE_COOKIE_NAME, state, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 10,
  })

  return response
}
