"use client"

import dynamic from "next/dynamic"
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

const MobilePracticeViewer = dynamic(
  () => import("./mobile-practice-viewer").then((module) => module.MobilePracticeViewer),
  {
    ssr: false,
    loading: () => (
      <main className="flex min-h-screen items-center justify-center bg-neutral-100 px-6 text-neutral-900">
        <div className="w-full max-w-sm rounded-3xl border border-neutral-200 bg-white p-6 text-center shadow-sm">
          <p className="text-sm text-neutral-600">Preparando visor...</p>
        </div>
      </main>
    ),
  }
)

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
      <MobilePracticeViewer
        material={{
          id: material.id,
          fileName: material.fileName,
          sessionDate: material.sessionDate,
          subjectName: material.subjectName,
        }}
      />
    )
  }

  return <PracticeViewerClient material={material} draftContext={draftContext} />
}
