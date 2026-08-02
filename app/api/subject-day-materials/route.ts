import { NextResponse } from "next/server"
import { listLocalSubjectDayMaterials } from "@/lib/local-r2-manifests"
import { isLocalStorageMode } from "@/lib/storage-mode"
import { getWeekNumberForDate, parseDateKey } from "@/lib/subject-utils"
import { ensureSubjectAccess, requireAuthSession } from "@/lib/authz"
import { listPinnedSubjectMaterials, listSubjectDayMaterials, reconcileSubjectDayMaterialsFromR2 } from "@/lib/subject-day-materials-r2"
import { getSubjectDayMaterialMetadataOrAutocleanup } from "@/lib/subject-day-materials-storage"
import { listTagsForMaterials } from "@/lib/material-tags"

export const runtime = "nodejs"

function blockedLocalApi(path: string) {
  return NextResponse.json(
    { error: `Endpoint ${path} deshabilitado en modo local. Usa la carpeta workspace desde el navegador.` },
    {
      status: 501,
      headers: {
        "x-data-source": "blocked-server-api",
      },
    }
  )
}

function isMissingSubjectDayMaterialsTable(error: unknown) {
  return Boolean(
    error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "42P01"
  )
}

function badRequest(message: string) {
  return NextResponse.json({ error: message }, { status: 400 })
}

function parseSessionDate(sessionDate: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(sessionDate)) return null
  const parsed = parseDateKey(sessionDate)
  if (Number.isNaN(parsed.getTime())) return null
  return parsed
}

export async function GET(request: Request) {
  try {
    if (isLocalStorageMode()) {
      return blockedLocalApi("/api/subject-day-materials")
    }

    const auth = await requireAuthSession()
    if (auth.response) return auth.response

    const { searchParams } = new URL(request.url)
    const subjectId = searchParams.get("subjectId")
    const sessionDate = searchParams.get("sessionDate")
    const scope = searchParams.get("scope")
    const materialTypeParam = searchParams.get("materialType")
    const materialType = materialTypeParam === "theory" || materialTypeParam === "practice" ? materialTypeParam : null

    if (!subjectId) {
      return badRequest("Missing subjectId")
    }

    if (materialTypeParam && !materialType) {
      return badRequest("Invalid materialType")
    }

    const forbidden = ensureSubjectAccess(auth.session!, subjectId)
    if (forbidden) return forbidden

    const rawWeekNumber = Number.parseInt(searchParams.get("weekNumber") || "", 10)
    let weekNumber = rawWeekNumber

    const shouldReconcile = Boolean(subjectId) && (!Number.isNaN(rawWeekNumber) || Boolean(sessionDate))

    if (scope === "pinned") {
      weekNumber = Number.NaN
    } else if (scope === "week") {
      if (Number.isNaN(rawWeekNumber)) {
        return badRequest("Missing weekNumber")
      }

      if (shouldReconcile) {
        try {
          const result = await reconcileSubjectDayMaterialsFromR2({
            subjectId,
            weekNumber,
            materialType,
          })
          if (result.inserted > 0) {
            console.info("GET /api/subject-day-materials reconciled weekly materials from R2", {
              subjectId,
              weekNumber,
              materialType: materialType ?? "all",
              inserted: result.inserted,
              scanned: result.scanned,
              skipped: result.skipped,
            })
          } else if (result.scanned > 0) {
            console.info("GET /api/subject-day-materials weekly reconciliation scanned R2 without inserts", {
              subjectId,
              weekNumber,
              materialType: materialType ?? "all",
              scanned: result.scanned,
              skipped: result.skipped,
              diagnostics: result.diagnostics,
            })
          }
        } catch (error) {
          console.error("GET /api/subject-day-materials weekly reconciliation failed:", error)
        }
      }
    } else {
      if (!sessionDate) {
        return badRequest("Missing sessionDate")
      }

      const parsedSessionDate = parseSessionDate(sessionDate)
      if (!parsedSessionDate) {
        return badRequest("Invalid sessionDate")
      }

      weekNumber = Number.isNaN(rawWeekNumber) ? getWeekNumberForDate(parsedSessionDate) : rawWeekNumber
      if (shouldReconcile) {
        try {
          const result = await reconcileSubjectDayMaterialsFromR2({
            subjectId,
            weekNumber,
            sessionDate,
            materialType: null,
          })
          if (result.inserted > 0) {
            console.info("GET /api/subject-day-materials reconciled daily materials from R2", {
              subjectId,
              weekNumber,
              sessionDate,
              inserted: result.inserted,
              scanned: result.scanned,
              skipped: result.skipped,
            })
          } else if (result.scanned > 0) {
            console.info("GET /api/subject-day-materials daily reconciliation scanned R2 without inserts", {
              subjectId,
              weekNumber,
              sessionDate,
              scanned: result.scanned,
              skipped: result.skipped,
              diagnostics: result.diagnostics,
            })
          }
        } catch (error) {
          console.error("GET /api/subject-day-materials daily reconciliation failed:", error)
        }
      }
    }

    if (isLocalStorageMode()) {
      const materials = await listLocalSubjectDayMaterials({
        subjectId,
        weekNumber,
        sessionDate: scope === "week" ? undefined : sessionDate!,
        materialType,
      })

      return NextResponse.json(materials)
    }

    const rows = scope === "pinned"
      ? await listPinnedSubjectMaterials(subjectId)
      : await listSubjectDayMaterials({
          subjectId,
          weekNumber,
          sessionDate: scope === "week" ? undefined : sessionDate!,
          materialType,
        })
    const availabilityChecks = await Promise.all(
      rows.map(async (row) => ({
        row,
        remote: await getSubjectDayMaterialMetadataOrAutocleanup({
          id: row.id,
          drive_file_id: row.drive_file_id,
        }),
      }))
    )
    const visibleRows = availabilityChecks
      .filter((entry) => entry.remote.status !== "missing")
      .map((entry) => entry.row)
    const removedCount = availabilityChecks.filter((entry) => entry.remote.status === "missing").length
    const unavailableRows = availabilityChecks.filter((entry) => entry.remote.status === "unavailable")

    if (removedCount > 0) {
      console.warn("GET /api/subject-day-materials removed orphan materials during listing", {
        subjectId,
        weekNumber: scope === "pinned" ? undefined : weekNumber,
        sessionDate: scope === "week" || scope === "pinned" ? undefined : sessionDate!,
        materialType: materialType ?? "all",
        removedCount,
      })
    }

    if (unavailableRows.length > 0) {
      console.warn("GET /api/subject-day-materials found materials with unavailable remote metadata", {
        subjectId,
        weekNumber: scope === "pinned" ? undefined : weekNumber,
        sessionDate: scope === "week" || scope === "pinned" ? undefined : sessionDate!,
        materialType: materialType ?? "all",
        materialIds: unavailableRows.map((entry) => entry.row.id),
        driveFileIds: unavailableRows.map((entry) => entry.row.drive_file_id),
      })
    }

    let tagsByMaterialId: Record<string, Awaited<ReturnType<typeof listTagsForMaterials>>[string]> = {}
    try {
      tagsByMaterialId = await listTagsForMaterials(visibleRows.map((row) => row.id))
    } catch (error) {
      console.warn("GET /api/subject-day-materials could not attach tags:", error)
    }

    return NextResponse.json(
      visibleRows.map((row) => ({
        ...row,
        tags: tagsByMaterialId[String(row.id)] ?? [],
      }))
    )
  } catch (error) {
    console.error("GET /api/subject-day-materials error:", error)
    if (isMissingSubjectDayMaterialsTable(error)) {
      return NextResponse.json([])
    }
    return NextResponse.json({ error: "Failed to fetch materials" }, { status: 500 })
  }
}

export async function POST(request: Request) {
  void request
  return NextResponse.json(
    { error: "Legacy upload is disabled. Use /api/subject-day-materials/upload-session and /complete." },
    { status: 410 }
  )
}
