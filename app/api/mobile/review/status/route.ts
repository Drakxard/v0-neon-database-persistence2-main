import { NextResponse } from "next/server"

import { verifyMobileReviewSignature } from "@/lib/mobile-review-auth"
import { getMobileReviewStatus, isMissingMobileReviewDependency } from "@/lib/mobile-review"

function badRequest(message: string) {
  return NextResponse.json({ error: message }, { status: 400 })
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const deviceId = searchParams.get("device")?.trim() || ""
    const signature = searchParams.get("sig")?.trim() || ""
    if (!deviceId) return badRequest("Missing device")
    if (!verifyMobileReviewSignature(deviceId, signature)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    return NextResponse.json(await getMobileReviewStatus(deviceId))
  } catch (error) {
    console.error("GET /api/mobile/review/status error:", error)
    if (isMissingMobileReviewDependency(error)) {
      return NextResponse.json(
        { error: "Faltan migraciones de mobile review en Neon (scripts/017 y 018, ademas de 016 para pares)." },
        { status: 503 }
      )
    }
    return NextResponse.json({ error: "Failed to load mobile review status" }, { status: 500 })
  }
}
