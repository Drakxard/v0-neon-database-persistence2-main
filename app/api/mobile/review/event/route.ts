import { NextResponse } from "next/server"

import { verifyMobileReviewSignature } from "@/lib/mobile-review-auth"
import { isMissingMobileReviewDependency, logMobileReviewEvent } from "@/lib/mobile-review"

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

    const eventType =
      body?.eventType === "shown" ||
      body?.eventType === "revealed" ||
      body?.eventType === "rated" ||
      body?.eventType === "skipped"
        ? body.eventType
        : null

    const taskKind =
      body?.taskKind === "material_pair" ||
      body?.taskKind === "subject_anchor" ||
      body?.taskKind === "coverage_gap"
        ? body.taskKind
        : null

    const rating =
      body?.rating === "ok" || body?.rating === "doubt" || body?.rating === "fail"
        ? body.rating
        : null

    const subjectId = typeof body?.subjectId === "string" ? body.subjectId.trim() : ""
    const weekNumber = Number(body?.weekNumber)
    const materialId =
      body?.materialId !== null && body?.materialId !== undefined && Number.isInteger(Number(body?.materialId))
        ? Number(body.materialId)
        : null
    const pairId = typeof body?.pairId === "string" ? body.pairId.trim() || null : null

    if (!eventType || !taskKind || !subjectId || !Number.isInteger(weekNumber)) {
      return badRequest("Invalid mobile review event payload")
    }

    await logMobileReviewEvent({
      deviceId,
      subjectId,
      weekNumber,
      materialId,
      pairId,
      taskKind,
      eventType,
      rating,
    })

    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error("POST /api/mobile/review/event error:", error)
    if (isMissingMobileReviewDependency(error)) {
      return NextResponse.json(
        { error: "Faltan migraciones de mobile review en Neon (scripts/017, 018 y 019)." },
        { status: 503 }
      )
    }
    return NextResponse.json({ error: "Failed to store mobile review event" }, { status: 500 })
  }
}
