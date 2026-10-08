"use client"

import { useEffect, useState } from "react"
import { SubjectPdfFragment } from "./subject-pdf-fragment"
import type { PdfSearchResult } from "@/lib/subject-pdf-search"

const keyFor = (result: PdfSearchResult) => JSON.stringify([result.id, result.fileId, result.query, result.title, result.candidate, result.decision])

export function SubjectPdfViewPool({ candidates, active, subjectId, onBack, onUndo, onSearchAgain }: {
  candidates: PdfSearchResult[]; active: PdfSearchResult | null; subjectId: string;
  onBack: () => void; onUndo: () => void; onSearchAgain: () => void
}) {
  const [prepared, setPrepared] = useState<PdfSearchResult[]>([])
  const activeKey = active ? keyFor(active) : null
  const candidateKeys = JSON.stringify(candidates.slice(0, 3).map(keyFor))
  useEffect(() => {
    setPrepared(previous => {
      if (!active && !candidates.length) return previous
      const wanted = [...new Map([...(active ? [active] : []), ...candidates].map(result => [keyFor(result), result])).values()].slice(0, 3)
      return wanted.map(result => previous.find(item => keyFor(item) === keyFor(result)) ?? result)
    })
    // Preserve mounted, rendered viewers when a search republishes equivalent results.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeKey, candidateKeys])
  const views = active && !prepared.some(result => keyFor(result) === activeKey) ? [active, ...prepared].slice(0, 3) : prepared
  return <>{views.map(result => {
    const viewing = keyFor(result) === activeKey
    return <div key={keyFor(result)} aria-hidden={!viewing} inert={!viewing} data-pdf-preloaded={result.id}
      style={{ position: "fixed", inset: 0, zIndex: 10, opacity: viewing ? 1 : 0, pointerEvents: viewing ? "auto" : "none", display: "flex", flexDirection: "column" }}>
      <SubjectPdfFragment result={result} subjectId={subjectId} active={viewing} onBack={onBack} onUndo={onUndo} onSearchAgain={onSearchAgain} />
    </div>
  })}</>
}
