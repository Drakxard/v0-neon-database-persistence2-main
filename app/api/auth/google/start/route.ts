import { NextResponse } from "next/server"

export const runtime = "nodejs"

export async function GET(request: Request) {
  const url = new URL(request.url)
  const loginUrl = new URL("/login", url.origin)
  loginUrl.searchParams.set("error", "El login con Google fue desactivado. Entra con tu correo.")
  return NextResponse.redirect(loginUrl, { status: 303 })
}
