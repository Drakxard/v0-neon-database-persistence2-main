import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"

import { isLocalStorageMode } from "@/lib/storage-mode"
import { SUBJECT_IDS } from "@/lib/subjects"

export function proxy(request: NextRequest) {
  if (isLocalStorageMode() && request.nextUrl.pathname.startsWith("/api/")) {
    if (
      request.method.toUpperCase() === "GET" &&
      (request.nextUrl.pathname === "/api/google/oauth/start" ||
        request.nextUrl.pathname === "/api/google/oauth/callback")
    ) {
      return NextResponse.next()
    }
    if (request.nextUrl.pathname.startsWith("/api/google/drive/")) return NextResponse.next()

    if (
      (request.nextUrl.pathname === "/api/pdf-translate" && request.method.toUpperCase() === "POST") ||
      request.nextUrl.pathname.startsWith("/api/inscreen/")
    ) {
      return NextResponse.next()
    }

    if (request.nextUrl.pathname === "/api/auth/session" && request.method.toUpperCase() === "GET") {
      return NextResponse.json(
        {
          email: "local@app.local",
          isAdmin: true,
          allowedSubjectIds: SUBJECT_IDS,
        },
        {
          headers: {
            "x-data-source": "static-local-session",
          },
        }
      )
    }

    return NextResponse.json(
      { error: `Endpoint ${request.nextUrl.pathname} deshabilitado en modo local.` },
      {
        status: 501,
        headers: {
          "x-data-source": "blocked-server-api",
        },
      }
    )
  }

  return NextResponse.next()
}

export const config = {
  matcher: ["/((?!.*\\..*).*)", "/api/:path*"],
}
