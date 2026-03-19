import { NextResponse } from "next/server"

import { requireAdminSession } from "@/lib/authz"
import { reconcileSubjectDayMaterialsFromR2, type MaterialType } from "@/lib/subject-day-materials-r2"

export const runtime = "nodejs"

function parseMaterialType(value: unknown): MaterialType | null | undefined {
  if (value === undefined) return undefined
  if (value === null || value === "") return null
  if (value === "theory" || value === "practice") return value
  return undefined
}

export async function POST(request: Request) {
  try {
    const auth = await requireAdminSession()
    if (auth.response) return auth.response

    const payload = await request.json().catch(() => ({}))
    const weekNumber = Number.parseInt(String(payload?.weekNumber ?? ""), 10)
    const sessionDate = String(payload?.sessionDate || "").trim() || undefined
    const subjectId = String(payload?.subjectId || "").trim() || undefined
    const materialType = parseMaterialType(payload?.materialType)

    if (payload?.weekNumber !== undefined && !Number.isInteger(weekNumber)) {
      return NextResponse.json({ error: "Invalid weekNumber" }, { status: 400 })
    }
    if (payload?.materialType !== undefined && materialType === undefined) {
      return NextResponse.json({ error: "Invalid materialType" }, { status: 400 })
    }

    const result = await reconcileSubjectDayMaterialsFromR2({
      subjectId,
      weekNumber: Number.isInteger(weekNumber) ? weekNumber : undefined,
      sessionDate,
      materialType,
    })

    return NextResponse.json({
      success: true,
      ...result,
      scope: {
        subjectId: subjectId ?? null,
        weekNumber: Number.isInteger(weekNumber) ? weekNumber : null,
        sessionDate: sessionDate ?? null,
        materialType: materialType ?? null,
      },
    })
  } catch (error) {
    console.error("POST /api/admin/subject-day-materials/reconcile error:", error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to reconcile subject day materials" },
      { status: 500 }
    )
  }
}
