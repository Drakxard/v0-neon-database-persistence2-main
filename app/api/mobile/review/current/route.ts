import { NextResponse } from "next/server"

import { buildMobileReviewSignedQuery, verifyMobileReviewSignature } from "@/lib/mobile-review-auth"
import { getMobileReviewStatus, isMissingMobileReviewDependency, resolveMobileReviewPair, withSignedAudioUrls } from "@/lib/mobile-review"

function badRequest(message: string) {
  return NextResponse.json({ error: message }, { status: 400 })
}

function getAuthParams(request: Request) {
  const { searchParams } = new URL(request.url)
  const deviceId = searchParams.get("device")?.trim() || ""
  const signature = searchParams.get("sig")?.trim() || ""
  return { deviceId, signature }
}

export async function GET(request: Request) {
  try {
    const { deviceId, signature } = getAuthParams(request)
    if (!deviceId) return badRequest("Missing device")
    if (!verifyMobileReviewSignature(deviceId, signature)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const resolved = await resolveMobileReviewPair({ deviceId })
    if (!resolved.activeSlot) {
      return NextResponse.json({
        pair: null,
        status: await getMobileReviewStatus(deviceId),
      })
    }

    if (!resolved.pair) {
      return NextResponse.json({
        pair: null,
        status: await getMobileReviewStatus(deviceId),
      })
    }

    const authQuery = buildMobileReviewSignedQuery(deviceId)
    return NextResponse.json({
      pair: withSignedAudioUrls(resolved.pair, authQuery),
      status: await getMobileReviewStatus(deviceId),
    })
  } catch (error) {
    console.error("GET /api/mobile/review/current error:", error)
    if (isMissingMobileReviewDependency(error)) {
      return NextResponse.json(
        { error: "Faltan migraciones de mobile review en Neon (scripts/017 y 018, ademas de 016 para pares)." },
        { status: 503 }
      )
    }
    return NextResponse.json({ error: "Failed to resolve current review pair" }, { status: 500 })
  }
}
