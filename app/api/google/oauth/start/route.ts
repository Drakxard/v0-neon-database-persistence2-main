import { NextResponse } from "next/server"

import { getGoogleOAuthConfig } from "@/lib/google-oauth"
import { createOAuthState, oauthStateCookie } from "@/lib/drive-user-config"

export const runtime = "nodejs"

export async function GET() {
  const { clientId, redirectUri, scope } = getGoogleOAuthConfig()
  const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth")
  authUrl.searchParams.set("client_id", clientId)
  authUrl.searchParams.set("redirect_uri", redirectUri)
  authUrl.searchParams.set("response_type", "code")
  authUrl.searchParams.set("scope", scope)
  authUrl.searchParams.set("access_type", "offline")
  authUrl.searchParams.set("prompt", "consent")
  const state = createOAuthState()
  authUrl.searchParams.set("state", state)

  const response = NextResponse.redirect(authUrl)
  response.headers.append("Set-Cookie", oauthStateCookie(state))
  return response
}
