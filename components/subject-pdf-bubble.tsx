"use client"

import { HandDrawnBubble } from "./hand-drawn-bubble"
import { usePdfLongPress } from "@/hooks/use-pdf-long-press"
import { correctPdfFragment } from "@/lib/client/subject-pdf-corrections"
import type { PdfSearchResult } from "@/lib/subject-pdf-search"

export function SubjectPdfBubble({ result, open, removed, failed, remove, disabled = false, color = "#a5d8ff" }: {
  result: PdfSearchResult; open: () => void; removed: () => void; failed: (error: unknown) => void; remove?: () => Promise<void>; disabled?: boolean; color?: string
}) {
  const press = usePdfLongPress(async () => { if (disabled) return; await (remove ? remove() : correctPdfFragment(result)); removed() }, failed)
  return <HandDrawnBubble {...press} seed={result.id} color={color} data-voice-pdf-id={result.id}
    className="select-none" disabled={disabled} title="Mantené presionado un segundo para eliminar este resultado" onClick={open}>
    <span className="block">{result.title}</span>
  </HandDrawnBubble>
}
