import { NextResponse } from "next/server"

import { buildMobileReviewSignedQuery, verifyMobileReviewSignature } from "@/lib/mobile-review-auth"
import { getMobileReviewStatus, isMissingMobileReviewDependency, resolveMobileReviewPair, withSignedTaskAudioUrls } from "@/lib/mobile-review"

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
        task: null,
        status: await getMobileReviewStatus(deviceId),
        currentIndex: resolved.currentIndex,
        totalPairs: resolved.totalPairs,
        debugReason: resolved.debugReason,
      })
    }

    if (!resolved.task) {
      return NextResponse.json({
        task: null,
        status: await getMobileReviewStatus(deviceId),
        currentIndex: resolved.currentIndex,
        totalPairs: resolved.totalPairs,
        debugReason: resolved.debugReason,
      })
    }

    const authQuery = buildMobileReviewSignedQuery(deviceId)
    return NextResponse.json({
      task: withSignedTaskAudioUrls(resolved.task, authQuery),
      status: await getMobileReviewStatus(deviceId),
      currentIndex: resolved.currentIndex,
      totalPairs: resolved.totalPairs,
      debugReason: resolved.debugReason,
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
