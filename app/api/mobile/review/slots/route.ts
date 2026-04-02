import { NextResponse } from "next/server"

import { verifyMobileReviewSignature } from "@/lib/mobile-review-auth"
import {
  createMobileReviewSlot,
  isMissingMobileReviewDependency,
  listMobileReviewSlots,
} from "@/lib/mobile-review"

function badRequest(message: string) {
  return NextResponse.json({ error: message }, { status: 400 })
}

function unauthorized() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
}

function getAuthParams(request: Request) {
  const { searchParams } = new URL(request.url)
  const deviceId = searchParams.get("device")?.trim() || ""
  const signature = searchParams.get("sig")?.trim() || ""
  return { deviceId, signature }
}

function getBodyAuth(body: unknown) {
  return {
    deviceId: typeof (body as { device?: unknown })?.device === "string" ? (body as { device: string }).device.trim() : "",
    signature: typeof (body as { sig?: unknown })?.sig === "string" ? (body as { sig: string }).sig.trim() : "",
  }
}

export async function GET(request: Request) {
  try {
    const { deviceId, signature } = getAuthParams(request)
    if (!deviceId) return badRequest("Missing device")
    if (!verifyMobileReviewSignature(deviceId, signature)) return unauthorized()

    return NextResponse.json({ slots: await listMobileReviewSlots() })
  } catch (error) {
    console.error("GET /api/mobile/review/slots error:", error)
    if (isMissingMobileReviewDependency(error)) {
      return NextResponse.json(
        { error: "Faltan migraciones de mobile review en Neon (scripts/017 y 018, ademas de 016 para pares)." },
        { status: 503 }
      )
    }
    return NextResponse.json({ error: "Failed to load review slots" }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null)
    const { deviceId, signature } = getBodyAuth(body)
    if (!deviceId) return badRequest("Missing device")
    if (!verifyMobileReviewSignature(deviceId, signature)) return unauthorized()

    const slot = await createMobileReviewSlot({
      subjectId: typeof body?.subjectId === "string" ? body.subjectId : "",
      weekdayIndex: typeof body?.weekdayIndex === "number" ? body.weekdayIndex : Number(body?.weekdayIndex),
      startTime: typeof body?.startTime === "string" ? body.startTime : "",
      endTime: typeof body?.endTime === "string" ? body.endTime : "",
      enabled: Boolean(body?.enabled),
      priority: typeof body?.priority === "number" ? body.priority : Number(body?.priority),
    })

    return NextResponse.json({ slot }, { status: 201 })
  } catch (error) {
    console.error("POST /api/mobile/review/slots error:", error)
    if (isMissingMobileReviewDependency(error)) {
      return NextResponse.json(
        { error: "Faltan migraciones de mobile review en Neon (scripts/017 y 018, ademas de 016 para pares)." },
        { status: 503 }
      )
    }
    if (error instanceof Error) {
      return NextResponse.json({ error: error.message }, { status: 400 })
    }
    return NextResponse.json({ error: "Failed to create review slot" }, { status: 500 })
  }
}
