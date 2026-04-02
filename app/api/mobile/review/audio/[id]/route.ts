import { NextResponse } from "next/server"

import { verifyMobileReviewSignature } from "@/lib/mobile-review-auth"
import { canAccessMobileReviewEntry, isMissingMobileReviewDependency, loadMobileReviewAudio } from "@/lib/mobile-review"

export const runtime = "nodejs"

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { searchParams } = new URL(request.url)
    const deviceId = searchParams.get("device")?.trim() || ""
    const signature = searchParams.get("sig")?.trim() || ""
    if (!deviceId || !verifyMobileReviewSignature(deviceId, signature)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { id } = await context.params
    const entryId = Number.parseInt(id, 10)
    if (!Number.isInteger(entryId)) {
      return NextResponse.json({ error: "Invalid entry id" }, { status: 400 })
    }

    const canAccess = await canAccessMobileReviewEntry(deviceId, entryId)
    if (!canAccess) {
      return NextResponse.json({ error: "Entry is not available for this device" }, { status: 403 })
    }

    const audio = await loadMobileReviewAudio(entryId)
    if (!audio) {
      return NextResponse.json({ error: "Entry not found" }, { status: 404 })
    }

    return new Response(audio.buffer, {
      headers: {
        "Content-Type": audio.mimeType,
        "Content-Disposition": `inline; filename="${audio.fileName}"`,
        "Cache-Control": "private, max-age=0, must-revalidate",
      },
    })
  } catch (error) {
    console.error("GET /api/mobile/review/audio/[id] error:", error)
    if (isMissingMobileReviewDependency(error)) {
      return NextResponse.json(
        { error: "Faltan migraciones de mobile review en Neon (scripts/017 y 018, ademas de 016 para pares)." },
        { status: 503 }
      )
    }
    return NextResponse.json({ error: "Failed to stream mobile review audio" }, { status: 500 })
  }
}
