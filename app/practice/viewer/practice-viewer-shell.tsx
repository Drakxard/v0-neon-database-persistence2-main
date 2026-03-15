"use client"

import { useEffect } from "react"

import { PracticeViewerClient } from "./practice-viewer-client"

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

function buildDefaultPdfJsViewerHref(materialId: number) {
  const fileParam = encodeURIComponent(`/api/subject-day-materials/${materialId}/file`)
  return `/pdfjs/web/viewer.html?file=${fileParam}#locale=es-AR`
}

export function PracticeViewerShell({
  material,
  draftContext,
}: {
  material?: MaterialContext
  draftContext?: DraftViewerContext
}) {
  useEffect(() => {
    if (!material) return

    window.location.replace(buildDefaultPdfJsViewerHref(material.id))
  }, [material])

  if (material) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-neutral-100 px-6 text-neutral-900">
        <div className="w-full max-w-sm rounded-3xl border border-neutral-200 bg-white p-6 text-center shadow-sm">
          <p className="text-sm font-medium text-neutral-800">Abriendo visor PDF.js...</p>
          <p className="mt-2 text-xs text-neutral-500">Se usa el Default Viewer oficial de PDF.js.</p>
          <a
            href={buildDefaultPdfJsViewerHref(material.id)}
            className="mt-4 inline-flex text-sm text-sky-700 underline underline-offset-4"
          >
            Abrir manualmente
          </a>
        </div>
      </main>
    )
  }

  return <PracticeViewerClient material={material} draftContext={draftContext} />
}
