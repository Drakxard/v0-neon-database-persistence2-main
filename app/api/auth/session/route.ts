import { NextResponse } from "next/server"

import { APP_AUTH_COOKIE_NAME, createSessionTokenFromPayload, getAppAuthConfig } from "@/lib/app-auth"
import { getCurrentSessionForEmail, getRequestAuthSession } from "@/lib/authz"

export const runtime = "nodejs"

const FIVE_MONTHS_IN_SECONDS = 60 * 60 * 24 * 30 * 5

export async function GET() {
  const session = await getRequestAuthSession()
  if (!session) {
    const response = NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    response.cookies.delete(APP_AUTH_COOKIE_NAME)
    return response
  }

  const currentSession = await getCurrentSessionForEmail(session.email)
  if (!currentSession) {
    const response = NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    response.cookies.delete(APP_AUTH_COOKIE_NAME)
    return response
  }

  const { sessionSecret } = getAppAuthConfig()
  const token = await createSessionTokenFromPayload(
    {
      email: currentSession.email,
      isAdmin: currentSession.isAdmin,
      allowedSubjectIds: currentSession.allowedSubjectIds,
    },
    sessionSecret,
    Date.now() + FIVE_MONTHS_IN_SECONDS * 1000
  )

  const response = NextResponse.json({
    email: currentSession.email,
    isAdmin: currentSession.isAdmin,
    allowedSubjectIds: currentSession.allowedSubjectIds,
  })

  response.cookies.set(APP_AUTH_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: FIVE_MONTHS_IN_SECONDS,
  })

  return response
}
