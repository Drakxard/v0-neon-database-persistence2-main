"use client"

import { useEffect, useState } from "react"

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

const MOBILE_MEDIA_QUERY = "(max-width: 767px)"

export function PracticeViewerShell({
  material,
  draftContext,
}: {
  material?: MaterialContext
  draftContext?: DraftViewerContext
}) {
  const [isMobile, setIsMobile] = useState<boolean | null>(material ? null : false)

  useEffect(() => {
    if (!material) return

    const mediaQuery = window.matchMedia(MOBILE_MEDIA_QUERY)
    const sync = () => setIsMobile(mediaQuery.matches)

    sync()
    mediaQuery.addEventListener("change", sync)

    return () => mediaQuery.removeEventListener("change", sync)
  }, [material])

  useEffect(() => {
    if (!material || !isMobile) return

    window.location.replace(`/api/subject-day-materials/${material.id}/file`)
  }, [isMobile, material])

  if (material && isMobile === null) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-neutral-100 px-6 text-neutral-900">
        <div className="w-full max-w-sm rounded-3xl border border-neutral-200 bg-white p-6 text-center shadow-sm">
          <p className="text-sm text-neutral-600">Preparando visor...</p>
        </div>
      </main>
    )
  }

  if (material && isMobile) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-neutral-100 px-6 text-neutral-900">
        <div className="w-full max-w-sm rounded-3xl border border-neutral-200 bg-white p-6 text-center shadow-sm">
          <p className="text-sm font-medium text-neutral-800">Abriendo PDF...</p>
          <p className="mt-2 text-xs text-neutral-500">Se usa el visor nativo del navegador para una experiencia mejor en celular.</p>
          <a
            href={`/api/subject-day-materials/${material.id}/file`}
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
