import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"

import { isLocalStorageMode } from "@/lib/storage-mode"
import { SUBJECT_IDS } from "@/lib/subjects"

export function middleware(request: NextRequest) {
  if (isLocalStorageMode() && request.nextUrl.pathname.startsWith("/api/")) {
    if (request.nextUrl.pathname === "/api/auth/session" && request.method.toUpperCase() === "GET") {
      return NextResponse.json({
        email: "local@app.local",
        isAdmin: true,
        allowedSubjectIds: SUBJECT_IDS,
      })
    }

    return NextResponse.json(
      { error: `Endpoint ${request.nextUrl.pathname} deshabilitado en modo local.` },
      { status: 501 }
    )
  }

  return NextResponse.next()
}

export const config = {
  matcher: ["/((?!.*\\..*).*)", "/api/:path*"],
}
