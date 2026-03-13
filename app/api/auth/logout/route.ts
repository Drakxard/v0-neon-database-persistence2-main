import { NextResponse } from "next/server"

import { APP_AUTH_COOKIE_NAME, APP_AUTH_STATE_COOKIE_NAME } from "@/lib/app-auth"

export async function POST(request: Request) {
  const response = NextResponse.json({ ok: true })
  const next = new URL(request.url).searchParams.get("next") || "/login"

  response.cookies.set(APP_AUTH_COOKIE_NAME, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  })
  response.cookies.set(APP_AUTH_STATE_COOKIE_NAME, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  })
  response.headers.set("x-auth-next", next)

  return response
}
