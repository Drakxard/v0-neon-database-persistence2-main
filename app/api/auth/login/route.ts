import { NextResponse } from "next/server"

import { APP_AUTH_COOKIE_NAME, createSessionTokenFromPayload, getAppAuthConfig } from "@/lib/app-auth"
import { getAdminSession, getAllowedAccountByEmail } from "@/lib/authz"

export const runtime = "nodejs"

const FIVE_MONTHS_IN_SECONDS = 60 * 60 * 24 * 30 * 5

function createLoginErrorRedirect(requestUrl: URL, message: string, email = "") {
  const loginUrl = new URL("/login", requestUrl.origin)
  loginUrl.searchParams.set("error", message)
  if (email) {
    loginUrl.searchParams.set("email", email)
  }

  return NextResponse.redirect(loginUrl, { status: 303 })
}

export async function POST(request: Request) {
  const requestUrl = new URL(request.url)
  const formData = await request.formData()
  const email = String(formData.get("email") || "").trim().toLowerCase()
  const next = String(formData.get("next") || "/")

  if (!email) {
    return createLoginErrorRedirect(requestUrl, "Ingresa un correo.", email)
  }

  const { adminEmail, sessionSecret } = getAppAuthConfig()
  const isAdmin = email === adminEmail
  const allowedAccount = isAdmin ? null : await getAllowedAccountByEmail(email)
  const allowedSubjectIds = isAdmin
    ? getAdminSession().allowedSubjectIds
    : (allowedAccount?.allowed_subject_ids ?? [])

  if (!isAdmin && allowedSubjectIds.length === 0) {
    return createLoginErrorRedirect(requestUrl, "Tu correo no tiene acceso.", email)
  }

  const token = await createSessionTokenFromPayload(
    {
      email,
      isAdmin,
      allowedSubjectIds,
    },
    sessionSecret,
    Date.now() + FIVE_MONTHS_IN_SECONDS * 1000
  )

  const response = NextResponse.redirect(new URL(next.startsWith("/") ? next : "/", requestUrl.origin), { status: 303 })
  response.cookies.set(APP_AUTH_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: FIVE_MONTHS_IN_SECONDS,
  })

  return response
}
