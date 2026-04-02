import { NextResponse } from "next/server"

import { buildMobileReviewSignedQuery, signMobileReviewDevice } from "@/lib/mobile-review-auth"

function normalizeDeviceId(value: unknown) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-_]/g, "")
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null)
    const deviceId = normalizeDeviceId(body?.device)
    if (!deviceId || deviceId.length < 3 || deviceId.length > 64) {
      return NextResponse.json({ error: "Ingresa un nombre de dispositivo valido." }, { status: 400 })
    }

    const signature = signMobileReviewDevice(deviceId)
    const query = buildMobileReviewSignedQuery(deviceId)

    return NextResponse.json({
      deviceId,
      signature,
      url: `/mobile/review?${query}`,
    })
  } catch (error) {
    console.error("POST /api/mobile/review/access error:", error)
    return NextResponse.json({ error: "No se pudo preparar el acceso." }, { status: 500 })
  }
}
