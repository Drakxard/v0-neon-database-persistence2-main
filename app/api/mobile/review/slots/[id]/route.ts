import { NextResponse } from "next/server"

import { verifyMobileReviewSignature } from "@/lib/mobile-review-auth"
import {
  deleteMobileReviewSlot,
  isMissingMobileReviewDependency,
  updateMobileReviewSlot,
} from "@/lib/mobile-review"

function badRequest(message: string) {
  return NextResponse.json({ error: message }, { status: 400 })
}

function unauthorized() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
}

function getBodyAuth(body: unknown) {
  return {
    deviceId: typeof (body as { device?: unknown })?.device === "string" ? (body as { device: string }).device.trim() : "",
    signature: typeof (body as { sig?: unknown })?.sig === "string" ? (body as { sig: string }).sig.trim() : "",
  }
}

function parseSlotId(id: string) {
  const slotId = Number.parseInt(id, 10)
  return Number.isInteger(slotId) ? slotId : null
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const body = await request.json().catch(() => null)
    const { deviceId, signature } = getBodyAuth(body)
    if (!deviceId) return badRequest("Missing device")
    if (!verifyMobileReviewSignature(deviceId, signature)) return unauthorized()

    const { id } = await context.params
    const slotId = parseSlotId(id)
    if (!slotId) return badRequest("Invalid slot id")

    const slot = await updateMobileReviewSlot(slotId, {
      subjectId: typeof body?.subjectId === "string" ? body.subjectId : "",
      weekdayIndex: typeof body?.weekdayIndex === "number" ? body.weekdayIndex : Number(body?.weekdayIndex),
      startTime: typeof body?.startTime === "string" ? body.startTime : "",
      endTime: typeof body?.endTime === "string" ? body.endTime : "",
      enabled: Boolean(body?.enabled),
      priority: typeof body?.priority === "number" ? body.priority : Number(body?.priority),
    })

    if (!slot) {
      return NextResponse.json({ error: "Slot not found" }, { status: 404 })
    }

    return NextResponse.json({ slot })
  } catch (error) {
    console.error("PATCH /api/mobile/review/slots/[id] error:", error)
    if (isMissingMobileReviewDependency(error)) {
      return NextResponse.json(
        { error: "Faltan migraciones de mobile review en Neon (scripts/017 y 018, ademas de 016 para pares)." },
        { status: 503 }
      )
    }
    if (error instanceof Error) {
      return NextResponse.json({ error: error.message }, { status: 400 })
    }
    return NextResponse.json({ error: "Failed to update review slot" }, { status: 500 })
  }
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const body = await request.json().catch(() => null)
    const { deviceId, signature } = getBodyAuth(body)
    if (!deviceId) return badRequest("Missing device")
    if (!verifyMobileReviewSignature(deviceId, signature)) return unauthorized()

    const { id } = await context.params
    const slotId = parseSlotId(id)
    if (!slotId) return badRequest("Invalid slot id")

    const deleted = await deleteMobileReviewSlot(slotId)
    if (!deleted) {
      return NextResponse.json({ error: "Slot not found" }, { status: 404 })
    }

    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error("DELETE /api/mobile/review/slots/[id] error:", error)
    if (isMissingMobileReviewDependency(error)) {
      return NextResponse.json(
        { error: "Faltan migraciones de mobile review en Neon (scripts/017 y 018, ademas de 016 para pares)." },
        { status: 503 }
      )
    }
    return NextResponse.json({ error: "Failed to delete review slot" }, { status: 500 })
  }
}
