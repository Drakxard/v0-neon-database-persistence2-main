import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"

const APP_AUTH_COOKIE_NAME = "app_auth_session"

function decodeBase64Url(input: string) {
  const normalized = input.replace(/-/g, "+").replace(/_/g, "/")
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4)
  const binary = atob(padded)
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0))
  return new TextDecoder().decode(bytes)
}

function constantTimeEquals(left: string, right: string) {
  if (left.length !== right.length) return false

  let result = 0
  for (let index = 0; index < left.length; index += 1) {
    result |= left.charCodeAt(index) ^ right.charCodeAt(index)
  }

  return result === 0
}

async function signPayload(payload: string, secret: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  )
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload))
  const bytes = new Uint8Array(signature)
  const base64 = btoa(String.fromCharCode(...bytes))
  return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "")
}

async function verifySession(token: string, secret: string) {
  const parts = token.split(".")
  if (parts.length !== 3) return null

  const [encodedEmail, encodedExpiry, providedSignature] = parts
  const payload = `${encodedEmail}.${encodedExpiry}`
  const expectedSignature = await signPayload(payload, secret)
  if (!constantTimeEquals(providedSignature, expectedSignature)) return null

  const expiresAtMs = Number.parseInt(encodedExpiry, 10)
  if (!Number.isFinite(expiresAtMs) || Date.now() > expiresAtMs) return null

  return {
    email: decodeBase64Url(encodedEmail).toLowerCase(),
    expiresAtMs,
  }
}

function isPublicPath(pathname: string) {
  return (
    pathname === "/login" ||
    pathname.startsWith("/api/auth/") ||
    pathname.startsWith("/_next/") ||
    pathname === "/favicon.ico" ||
    pathname === "/icon.svg" ||
    pathname === "/icon-light-32x32.png" ||
    pathname === "/icon-dark-32x32.png" ||
    pathname === "/apple-icon.png"
  )
}

export async function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl
  if (isPublicPath(pathname)) {
    if (pathname === "/login") {
      const token = request.cookies.get(APP_AUTH_COOKIE_NAME)?.value
      if (!token) return NextResponse.next()

      try {
        const allowedEmail = (process.env.ALLOWED_GOOGLE_EMAIL || "").toLowerCase()
        const sessionSecret = process.env.APP_AUTH_SECRET || ""
        const session = await verifySession(token, sessionSecret)
        if (session?.email === allowedEmail) {
          return NextResponse.redirect(new URL("/", request.url))
        }
      } catch {}
    }

    return NextResponse.next()
  }

  let allowedEmail = ""
  let sessionSecret = ""
  try {
    allowedEmail = (process.env.ALLOWED_GOOGLE_EMAIL || "").toLowerCase()
    sessionSecret = process.env.APP_AUTH_SECRET || ""
    if (!allowedEmail || !sessionSecret) {
      throw new Error("Missing auth configuration")
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Missing auth configuration"
    return pathname.startsWith("/api/")
      ? NextResponse.json({ error: message }, { status: 500 })
      : new NextResponse(message, { status: 500 })
  }

  const token = request.cookies.get(APP_AUTH_COOKIE_NAME)?.value
  const session = token ? await verifySession(token, sessionSecret) : null

  if (!session || session.email !== allowedEmail) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const loginUrl = new URL("/login", request.url)
    loginUrl.searchParams.set("next", `${pathname}${search}`)
    return NextResponse.redirect(loginUrl)
  }

  return NextResponse.next()
}

export const config = {
  matcher: ["/((?!.*\\..*).*)", "/api/:path*"],
}
