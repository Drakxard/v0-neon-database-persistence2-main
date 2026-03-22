"use client"

import { useEffect } from "react"

type MaterialContext = {
  id: number
  subjectId: string
  subjectName: string
  sessionDate: string
  weekNumber: number
  weekdayIndex: number
  fileName: string
}

type DraftViewerContext = {
  subjectId: string
  subjectName: string
  sessionDate: string
  weekNumber: number
  weekdayIndex: number
  materialType: "practice"
}

function buildPracticePdfJsViewerHref({
  material,
  draftContext,
}: {
  material?: MaterialContext
  draftContext?: DraftViewerContext
}) {
  const params = new URLSearchParams()

  if (material) {
    params.set("file", `/api/subject-day-materials/${material.id}/file`)
    params.set("materialId", String(material.id))
    params.set("fileName", material.fileName)
    params.set("key", `subject-day-material-${material.id}`)
    params.set("subjectId", material.subjectId)
    params.set("subjectName", material.subjectName)
    params.set("sessionDate", material.sessionDate)
    params.set("weekNumber", String(material.weekNumber))
    params.set("weekdayIndex", String(material.weekdayIndex))
  }

  if (draftContext) {
    params.set("file", "")
    params.set("subjectId", draftContext.subjectId)
    params.set("subjectName", draftContext.subjectName)
    params.set("sessionDate", draftContext.sessionDate)
    params.set("weekNumber", String(draftContext.weekNumber))
    params.set("weekdayIndex", String(draftContext.weekdayIndex))
    params.set("materialType", draftContext.materialType)
    params.set("key", `practice-draft:${draftContext.subjectId}:${draftContext.sessionDate}`)
  }

  return `/pdfjs/web/viewer.html?${params.toString()}#locale=es-AR`
}

export function PracticeViewerShell({
  material,
  draftContext,
}: {
  material?: MaterialContext
  draftContext?: DraftViewerContext
}) {
  useEffect(() => {
    if (!material && !draftContext) return

    window.location.replace(buildPracticePdfJsViewerHref({ material, draftContext }))
  }, [draftContext, material])

  const href = buildPracticePdfJsViewerHref({ material, draftContext })

  return (
    <main className="flex min-h-screen items-center justify-center bg-neutral-100 px-6 text-neutral-900">
      <div className="w-full max-w-sm rounded-3xl border border-neutral-200 bg-white p-6 text-center shadow-sm">
        <p className="text-sm font-medium text-neutral-800">Abriendo visor PDF.js...</p>
        <p className="mt-2 text-xs text-neutral-500">Se usa el Default Viewer oficial de PDF.js.</p>
        <a href={href} className="mt-4 inline-flex text-sm text-sky-700 underline underline-offset-4">
          Abrir manualmente
        </a>
      </div>
    </main>
  )
}
