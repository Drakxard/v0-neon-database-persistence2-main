"use client"

import { useLayoutEffect } from "react"

import {
  buildLocalContinuePayload,
  completeLocalAudioEntryUpload,
  completeLocalCronogramaUpload,
  completeLocalMaterialUpload,
  createLocalCronogramaUploadSession,
  createLocalEntryUploadSession,
  createLocalMaterialUploadSession,
  createLocalTextEntry,
  deleteLocalEntry,
  deleteLocalMaterial,
  deleteLocalSubjectCompletion,
  getLocalAiPrompt,
  getLocalCronograma,
  getLocalDailySession,
  getLocalEntryById,
  getLocalEntryAudioPositionList,
  getLocalMaterialById,
  getLocalSubjectCompletion,
  getLocalSubjectShortcuts,
  getWorkspaceFile,
  listLocalSubjectDayEntries,
  listLocalSubjectDayMaterials,
  saveLocalAiPrompt,
  saveLocalDailySession,
  saveLocalEntryAudioPosition,
  saveLocalEntryLink,
  saveLocalSubjectCompletion,
  saveLocalSubjectShortcut,
  syncLocalCronogramaPdf,
  syncLocalMaterialPdf,
  updateLocalEntry,
  updateLocalMaterial,
  uploadWorkspaceBlobFromFormData,
} from "@/lib/local-workspace-data"

function jsonResponse(payload: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(payload), {
    status: init?.status ?? 200,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  })
}

function errorResponse(message: string, status = 400) {
  return jsonResponse({ error: message }, { status })
}

function parseRequestJson<T>(request: Request) {
  return request.clone().json() as Promise<T>
}

function parsePathname(pathname: string) {
  return pathname.split("/").filter(Boolean)
}

function matchesPath(pathSegments: string[], expected: string[]) {
  return expected.length === pathSegments.length && expected.every((segment, index) => pathSegments[index] === segment)
}

async function handleLocalApiRequest(request: Request) {
  const url = new URL(request.url)
  const pathSegments = parsePathname(url.pathname)
  const method = request.method.toUpperCase()

  if (matchesPath(pathSegments, ["api", "ai-prompt"])) {
    if (method === "GET") {
      return jsonResponse({ prompt: await getLocalAiPrompt() })
    }
    if (method === "POST") {
      const body = await parseRequestJson<{ prompt?: string }>(request)
      return jsonResponse(await saveLocalAiPrompt(String(body?.prompt || "")))
    }
  }

  if (matchesPath(pathSegments, ["api", "ai-chat"]) && method === "POST") {
    return new Response("La IA remota esta deshabilitada en modo local.", {
      status: 200,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    })
  }

  if (matchesPath(pathSegments, ["api", "groq", "models"]) && method === "GET") {
    return jsonResponse({ models: [] })
  }

  if (matchesPath(pathSegments, ["api", "sessions"])) {
    if (method === "GET") {
      const date = String(url.searchParams.get("date") || "").trim()
      if (!date) return errorResponse("Missing date parameter")
      return jsonResponse(await getLocalDailySession(date))
    }
    if (method === "POST") {
      const body = await parseRequestJson<{
        date: string
        activeSubjectIds: string[]
        completedSubjects: Record<string, boolean>
        showAllSubjects: boolean
      }>(request)
      return jsonResponse(
        await saveLocalDailySession({
          date: body.date,
          activeSubjectIds: Array.isArray(body.activeSubjectIds) ? body.activeSubjectIds : [],
          completedSubjects: body.completedSubjects ?? {},
          showAllSubjects: Boolean(body.showAllSubjects),
        })
      )
    }
  }

  if (matchesPath(pathSegments, ["api", "subject-completions"])) {
    if (method === "GET") {
      const date = String(url.searchParams.get("date") || "").trim()
      const subjectId = String(url.searchParams.get("subjectId") || "").trim()
      if (!date || !subjectId) return errorResponse("Missing date or subjectId")
      return jsonResponse(await getLocalSubjectCompletion(date, subjectId))
    }
    if (method === "POST") {
      const body = await parseRequestJson<{ date: string; subjectId: string; panorama: string }>(request)
      return jsonResponse(
        await saveLocalSubjectCompletion({
          date: String(body?.date || "").trim(),
          subjectId: String(body?.subjectId || "").trim(),
          panorama: String(body?.panorama || ""),
        })
      )
    }
    if (method === "DELETE") {
      const body = await parseRequestJson<{ date: string; subjectId: string }>(request)
      return jsonResponse(
        await deleteLocalSubjectCompletion(String(body?.date || "").trim(), String(body?.subjectId || "").trim())
      )
    }
  }

  if (matchesPath(pathSegments, ["api", "subject-shortcuts"])) {
    if (method === "GET") {
      const subjectId = String(url.searchParams.get("subjectId") || "").trim()
      if (!subjectId) return errorResponse("Missing subjectId")
      return jsonResponse(await getLocalSubjectShortcuts(subjectId))
    }
    if (method === "PUT") {
      const body = await parseRequestJson<{ subjectId: string; shortcutKey: "e_fich" | "figma"; url: string }>(request)
      const shortcutKey = body?.shortcutKey === "e_fich" || body?.shortcutKey === "figma" ? body.shortcutKey : null
      if (!shortcutKey) return errorResponse("Invalid shortcutKey")
      return jsonResponse(
        await saveLocalSubjectShortcut({
          subjectId: String(body?.subjectId || "").trim(),
          shortcutKey,
          url: String(body?.url || ""),
        })
      )
    }
  }

  if (matchesPath(pathSegments, ["api", "cronograma"])) {
    if (method === "GET") {
      return jsonResponse(await getLocalCronograma())
    }
  }

  if (matchesPath(pathSegments, ["api", "cronograma", "upload-session"]) && method === "POST") {
    const body = await parseRequestJson<{ fileName: string; mimeType: string }>(request)
    return jsonResponse(
      await createLocalCronogramaUploadSession({
        fileName: String(body?.fileName || ""),
        mimeType: String(body?.mimeType || "application/pdf"),
      })
    )
  }

  if (matchesPath(pathSegments, ["api", "cronograma", "complete"]) && method === "POST") {
    const body = await parseRequestJson<{ driveFileId: string; fileName: string }>(request)
    return jsonResponse(
      await completeLocalCronogramaUpload({
        driveFileId: String(body?.driveFileId || "").trim(),
        fileName: String(body?.fileName || "").trim(),
      })
    )
  }

  if (matchesPath(pathSegments, ["api", "cronograma", "file"]) && method === "GET") {
    const cronograma = await getLocalCronograma()
    if (!cronograma?.driveFileId) return errorResponse("Cronograma not found", 404)
    const file = await getWorkspaceFile(cronograma.driveFileId)
    return new Response(file, {
      status: 200,
      headers: {
        "Content-Type": file.type || cronograma.driveMimeType || "application/pdf",
        "Content-Disposition": `inline; filename="${cronograma.fileName}"`,
      },
    })
  }

  if (matchesPath(pathSegments, ["api", "cronograma", "sync"]) && method === "POST") {
    return jsonResponse(await syncLocalCronogramaPdf(await request.formData()))
  }

  if (matchesPath(pathSegments, ["api", "storage", "r2-upload"]) && method === "POST") {
    return jsonResponse(await uploadWorkspaceBlobFromFormData(await request.formData()))
  }

  if (matchesPath(pathSegments, ["api", "subject-day-materials"])) {
    if (method === "GET") {
      const subjectId = String(url.searchParams.get("subjectId") || "").trim()
      const weekNumber = Number.parseInt(String(url.searchParams.get("weekNumber") || ""), 10)
      const sessionDate = String(url.searchParams.get("sessionDate") || "").trim()
      const scope = String(url.searchParams.get("scope") || "").trim()
      const materialTypeParam = String(url.searchParams.get("materialType") || "").trim()
      const materialType =
        materialTypeParam === "theory" || materialTypeParam === "practice" ? materialTypeParam : null
      if (!subjectId || !Number.isInteger(weekNumber)) {
        return errorResponse("Missing subjectId or weekNumber")
      }
      return jsonResponse(
        await listLocalSubjectDayMaterials({
          subjectId,
          weekNumber,
          sessionDate: scope === "week" ? undefined : sessionDate || undefined,
          materialType,
        })
      )
    }
  }

  if (matchesPath(pathSegments, ["api", "subject-day-materials", "upload-session"]) && method === "POST") {
    const body = await parseRequestJson<{
      subjectId: string
      sessionDate: string
      weekNumber?: number
      materialType: "theory" | "practice"
      fileName: string
      mimeType: string
    }>(request)
    const materialType = body?.materialType === "theory" || body?.materialType === "practice" ? body.materialType : null
    if (!materialType) return errorResponse("Invalid materialType")
    return jsonResponse(
      await createLocalMaterialUploadSession({
        subjectId: String(body?.subjectId || "").trim(),
        sessionDate: String(body?.sessionDate || "").trim(),
        weekNumber: body?.weekNumber,
        materialType,
        fileName: String(body?.fileName || ""),
        mimeType: String(body?.mimeType || "application/pdf"),
      })
    )
  }

  if (matchesPath(pathSegments, ["api", "subject-day-materials", "complete"]) && method === "POST") {
    const body = await parseRequestJson<{
      subjectId: string
      sessionDate: string
      weekNumber?: number
      materialType: "theory" | "practice"
      driveFileId: string
      fileName: string
    }>(request)
    const materialType = body?.materialType === "theory" || body?.materialType === "practice" ? body.materialType : null
    if (!materialType) return errorResponse("Invalid materialType")
    return jsonResponse(
      await completeLocalMaterialUpload({
        subjectId: String(body?.subjectId || "").trim(),
        sessionDate: String(body?.sessionDate || "").trim(),
        weekNumber: body?.weekNumber,
        materialType,
        driveFileId: String(body?.driveFileId || "").trim(),
        fileName: String(body?.fileName || ""),
      })
    )
  }

  if (matchesPath(pathSegments, ["api", "subject-day-materials", "next-theory"]) && method === "GET") {
    const subjectId = String(url.searchParams.get("subjectId") || "").trim()
    const sessionDate = String(url.searchParams.get("sessionDate") || "").trim()
    const weekNumber = Number.parseInt(String(url.searchParams.get("weekNumber") || ""), 10)
    return jsonResponse(
      await buildLocalContinuePayload({
        subjectId,
        sessionDate,
        weekNumber,
        mode: "theory",
      })
    )
  }

  if (matchesPath(pathSegments, ["api", "subject-day-materials", "next-practice"]) && method === "GET") {
    const subjectId = String(url.searchParams.get("subjectId") || "").trim()
    const sessionDate = String(url.searchParams.get("sessionDate") || "").trim()
    const weekNumber = Number.parseInt(String(url.searchParams.get("weekNumber") || ""), 10)
    return jsonResponse(
      await buildLocalContinuePayload({
        subjectId,
        sessionDate,
        weekNumber,
        mode: "practice",
      })
    )
  }

  if (pathSegments[0] === "api" && pathSegments[1] === "subject-day-materials" && pathSegments.length >= 3) {
    const materialId = Number.parseInt(pathSegments[2] || "", 10)
    if (!Number.isInteger(materialId)) return errorResponse("Invalid material id")

    if (pathSegments.length === 3) {
      if (method === "PATCH") {
        const body = await parseRequestJson<{ isCheckupDone?: boolean }>(request)
        const material = await updateLocalMaterial(materialId, {
          is_checkup_done: typeof body?.isCheckupDone === "boolean" ? body.isCheckupDone : undefined,
        })
        return material ? jsonResponse(material) : errorResponse("Material not found", 404)
      }
      if (method === "DELETE") {
        const material = await deleteLocalMaterial(materialId)
        return material ? jsonResponse({ success: true, id: materialId }) : errorResponse("Material not found", 404)
      }
    }

    if (pathSegments[3] === "file" && method === "GET") {
      const material = await getLocalMaterialById(materialId)
      if (!material?.drive_file_id) return errorResponse("Material not found", 404)
      const file = await getWorkspaceFile(material.drive_file_id)
      return new Response(file, {
        status: 200,
        headers: {
          "Content-Type": file.type || material.drive_mime_type || "application/pdf",
          "Content-Disposition": `inline; filename="${material.file_name}"`,
        },
      })
    }

    if (pathSegments[3] === "audio-positions") {
      if (method === "GET") {
        const positions = await getLocalEntryAudioPositionList(materialId)
        return positions ? jsonResponse(positions) : errorResponse("Material not found", 404)
      }
      if (method === "POST") {
        const body = await parseRequestJson<{ entryId: number; pageNum: number; xp: number; yp: number }>(request)
        const position = await saveLocalEntryAudioPosition({
          materialId,
          entryId: Number(body?.entryId),
          pageNum: Number(body?.pageNum),
          xp: Number(body?.xp),
          yp: Number(body?.yp),
        })
        return position ? jsonResponse(position) : errorResponse("Entry not found", 404)
      }
    }

    if (pathSegments[3] === "sync" && method === "POST") {
      const material = await syncLocalMaterialPdf(materialId, await request.formData())
      return material ? jsonResponse(material) : errorResponse("Material not found", 404)
    }

    if (pathSegments[3] === "replace-preview" || pathSegments[3] === "replace-commit") {
      return errorResponse("La migracion avanzada de reemplazo esta deshabilitada en modo local.", 501)
    }
  }

  if (matchesPath(pathSegments, ["api", "subject-day-entries"])) {
    if (method === "GET") {
      const subjectId = String(url.searchParams.get("subjectId") || "").trim()
      const weekNumberParam = url.searchParams.get("weekNumber")
      const sessionDate = String(url.searchParams.get("sessionDate") || "").trim()
      const materialIdParam = url.searchParams.get("materialId")
      const materialId = materialIdParam ? Number.parseInt(materialIdParam, 10) : null
      const weekNumber = weekNumberParam != null ? Number.parseInt(String(weekNumberParam), 10) : undefined
      return jsonResponse(
        await listLocalSubjectDayEntries({
          subjectId,
          weekNumber: Number.isInteger(weekNumber) ? weekNumber : undefined,
          sessionDate: sessionDate || undefined,
          materialId: Number.isInteger(materialId) ? materialId : null,
        })
      )
    }
    if (method === "POST") {
      const body = await parseRequestJson<{
        subjectId: string
        sessionDate: string
        weekNumber: number
        weekdayIndex: number
        materialId: number | null
        transcriptText: string
        answerText?: string
      }>(request)
      return jsonResponse(
        await createLocalTextEntry({
          subjectId: String(body?.subjectId || "").trim(),
          sessionDate: String(body?.sessionDate || "").trim(),
          weekNumber: Number(body?.weekNumber),
          weekdayIndex: Number(body?.weekdayIndex),
          materialId: typeof body?.materialId === "number" ? body.materialId : null,
          transcriptText: String(body?.transcriptText || ""),
          answerText: typeof body?.answerText === "string" ? body.answerText : "",
        })
      )
    }
  }

  if (matchesPath(pathSegments, ["api", "subject-day-entries", "upload-session"]) && method === "POST") {
    const body = await parseRequestJson<{
      subjectId: string
      sessionDate: string
      weekNumber?: number
      materialId?: number | null
      mimeType: string
      subjectName?: string
    }>(request)
    return jsonResponse(
      await createLocalEntryUploadSession({
        subjectId: String(body?.subjectId || "").trim(),
        sessionDate: String(body?.sessionDate || "").trim(),
        weekNumber: body?.weekNumber,
        materialId: typeof body?.materialId === "number" ? body.materialId : null,
        mimeType: String(body?.mimeType || "audio/webm"),
        subjectName: typeof body?.subjectName === "string" ? body.subjectName : "",
      })
    )
  }

  if (matchesPath(pathSegments, ["api", "subject-day-entries", "complete"]) && method === "POST") {
    const body = await parseRequestJson<{
      subjectId: string
      sessionDate: string
      weekNumber?: number
      materialId: number | null
      driveFileId: string
      fileName: string
      pairId: string | null
      pairRole: "question" | "answer" | null
    }>(request)
    return jsonResponse(
      await completeLocalAudioEntryUpload({
        subjectId: String(body?.subjectId || "").trim(),
        sessionDate: String(body?.sessionDate || "").trim(),
        weekNumber: body?.weekNumber,
        materialId: typeof body?.materialId === "number" ? body.materialId : null,
        driveFileId: String(body?.driveFileId || "").trim(),
        fileName: String(body?.fileName || "").trim(),
        pairId: typeof body?.pairId === "string" ? body.pairId : null,
        pairRole: body?.pairRole === "question" || body?.pairRole === "answer" ? body.pairRole : null,
      })
    )
  }

  if (pathSegments[0] === "api" && pathSegments[1] === "subject-day-entries" && pathSegments.length >= 3) {
    const entryId = Number.parseInt(pathSegments[2] || "", 10)
    if (!Number.isInteger(entryId)) return errorResponse("Invalid entry id")

    if (pathSegments.length === 3) {
      if (method === "PATCH") {
        const body = await parseRequestJson<{
          answerText?: string | null
          transcriptText?: string | null
          customTitle?: string | null
          practiceState?: "erre" | null
          isFeatured?: boolean
          featuredScope?: "entry_scope" | "subject_week"
          pairRole?: "question" | "answer"
          targetMaterialId?: number
        }>(request)
        const practiceState = body?.practiceState === "erre" ? "erre" : body?.practiceState === null ? null : undefined
        const pairRole = body?.pairRole === "question" || body?.pairRole === "answer" ? body.pairRole : undefined
        const entry = await updateLocalEntry(entryId, {
          answerText: body?.answerText,
          transcriptText: body?.transcriptText,
          customTitle: body?.customTitle,
          practiceState,
          isFeatured: typeof body?.isFeatured === "boolean" ? body.isFeatured : undefined,
          featuredScope: body?.featuredScope === "subject_week" ? "subject_week" : "entry_scope",
          pairRole,
          targetMaterialId: typeof body?.targetMaterialId === "number" ? body.targetMaterialId : undefined,
        })
        return entry ? jsonResponse(entry) : errorResponse("Entry not found", 404)
      }
      if (method === "DELETE") {
        const result = await deleteLocalEntry(entryId)
        return result ? jsonResponse(result) : errorResponse("Entry not found", 404)
      }
    }

    if (pathSegments[3] === "links" && method === "POST") {
      const body = await parseRequestJson<{ label: string; url: string }>(request)
      const link = await saveLocalEntryLink(entryId, {
        label: String(body?.label || ""),
        url: String(body?.url || ""),
      })
      return link ? jsonResponse(link) : errorResponse("Entry not found", 404)
    }

    if (pathSegments[3] === "audio" && method === "GET") {
      const entry = await getLocalEntryById(entryId)
      if (!entry?.drive_file_id) return errorResponse("Audio not found", 404)
      const file = await getWorkspaceFile(entry.drive_file_id)
      return new Response(file, {
        status: 200,
        headers: {
          "Content-Type": file.type || entry.drive_mime_type || "audio/webm",
          "Content-Disposition": `inline; filename="${entry.drive_file_name || file.name}"`,
        },
      })
    }
  }

  return null
}

export function LocalFetchInterceptor() {
  useLayoutEffect(() => {
    const originalFetch = window.fetch.bind(window)

    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const request =
        input instanceof Request
          ? input
          : new Request(typeof input === "string" ? new URL(input, window.location.origin).toString() : input.toString(), init)

      const url = new URL(request.url)
      if (url.origin !== window.location.origin || !url.pathname.startsWith("/api/")) {
        return originalFetch(input, init)
      }
      if (url.searchParams.get("localWorkspaceBypass") === "1") {
        return originalFetch(input, init)
      }

      try {
        const response = await handleLocalApiRequest(request)
        if (response) return response
      } catch (error) {
        const message = error instanceof Error ? error.message : "Local mode request failed."
        return errorResponse(message, 500)
      }

      return originalFetch(input, init)
    }

    return () => {
      window.fetch = originalFetch
    }
  }, [])

  return null
}
