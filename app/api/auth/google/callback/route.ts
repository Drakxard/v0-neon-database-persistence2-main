import { cookies } from "next/headers"
import { NextResponse } from "next/server"

import {
  APP_AUTH_COOKIE_NAME,
  APP_AUTH_STATE_COOKIE_NAME,
  createSessionTokenFromPayload,
  exchangeCodeForIdentity,
  getAppAuthConfig,
} from "@/lib/app-auth"
import { getAdminSession, getAllowedAccountByEmail } from "@/lib/authz"

export const runtime = "nodejs"

function renderHtml(title: string, message: string, status = 400) {
  return new Response(
    `<html><body style="font-family: sans-serif; padding: 24px;"><h1>${title}</h1><p>${message}</p></body></html>`,
    {
      headers: { "Content-Type": "text/html; charset=utf-8" },
      status,
    }
  )
}

export async function GET(request: Request) {
  const url = new URL(request.url)
  const code = url.searchParams.get("code")
  const error = url.searchParams.get("error")
  const returnedState = url.searchParams.get("state") || ""
  const cookieStore = await cookies()
  const storedState = cookieStore.get(APP_AUTH_STATE_COOKIE_NAME)?.value || ""

  if (error) {
    return renderHtml("Login cancelado", error, 400)
  }

  const [stateValue, next = "/"] = returnedState.split(":")
  if (!stateValue || !storedState || stateValue !== storedState) {
    return renderHtml("Estado invalido", "La validacion del login con Google fallo.", 400)
  }

  if (!code) {
    return renderHtml("Falta code", "Google no devolvio el codigo de autenticacion.", 400)
  }

  try {
    const { adminEmail, sessionSecret } = getAppAuthConfig()
    const identity = await exchangeCodeForIdentity(code)
    const isAdmin = identity.email === adminEmail
    const allowedAccount = isAdmin ? null : await getAllowedAccountByEmail(identity.email)
    const allowedSubjectIds = isAdmin
      ? getAdminSession().allowedSubjectIds
      : (allowedAccount?.allowed_subject_ids ?? [])

    if (!isAdmin && allowedSubjectIds.length === 0) {
      const deniedResponse = renderHtml("Acceso denegado", "", 403)
      deniedResponse.headers.append(
        "Set-Cookie",
        `${APP_AUTH_STATE_COOKIE_NAME}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax${process.env.NODE_ENV === "production" ? "; Secure" : ""}`
      )
      return deniedResponse
    }

    const token = await createSessionTokenFromPayload(
      {
        email: identity.email,
        isAdmin,
        allowedSubjectIds,
      },
      sessionSecret,
      Date.now() + 1000 * 60 * 60 * 24 * 30
    )
    const response = NextResponse.redirect(new URL(next.startsWith("/") ? next : "/", url.origin))
    response.cookies.set(APP_AUTH_STATE_COOKIE_NAME, "", {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 0,
    })
    response.cookies.set(APP_AUTH_COOKIE_NAME, token, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 24 * 30,
    })

    return response
  } catch (authError) {
    const message = authError instanceof Error ? authError.message : "Fallo el login con Google"
    return renderHtml("Error de autenticacion", message, 500)
  }
}
