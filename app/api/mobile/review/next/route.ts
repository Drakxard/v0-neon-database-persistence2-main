import { NextResponse } from "next/server"

import { buildMobileReviewSignedQuery, verifyMobileReviewSignature } from "@/lib/mobile-review-auth"
import { getMobileReviewStatus, isMissingMobileReviewDependency, resolveMobileReviewPair, withSignedAudioUrls } from "@/lib/mobile-review"

function badRequest(message: string) {
  return NextResponse.json({ error: message }, { status: 400 })
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null)
    const deviceId = typeof body?.device === "string" ? body.device.trim() : ""
    const signature = typeof body?.sig === "string" ? body.sig.trim() : ""
    if (!deviceId) return badRequest("Missing device")
    if (!verifyMobileReviewSignature(deviceId, signature)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const resolved = await resolveMobileReviewPair({ deviceId, forceNext: true })
    if (!resolved.activeSlot || !resolved.pair) {
      return NextResponse.json({
        pair: null,
        status: await getMobileReviewStatus(deviceId),
        currentIndex: resolved.currentIndex,
        totalPairs: resolved.totalPairs,
        debugReason: resolved.debugReason,
      })
    }

    const authQuery = buildMobileReviewSignedQuery(deviceId)
    return NextResponse.json({
      pair: withSignedAudioUrls(resolved.pair, authQuery),
      status: await getMobileReviewStatus(deviceId),
      currentIndex: resolved.currentIndex,
      totalPairs: resolved.totalPairs,
      debugReason: resolved.debugReason,
    })
  } catch (error) {
    console.error("POST /api/mobile/review/next error:", error)
    if (isMissingMobileReviewDependency(error)) {
      return NextResponse.json(
        { error: "Faltan migraciones de mobile review en Neon (scripts/017 y 018, ademas de 016 para pares)." },
        { status: 503 }
      )
    }
    return NextResponse.json({ error: "Failed to resolve next review pair" }, { status: 500 })
  }
}
