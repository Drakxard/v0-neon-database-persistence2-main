"use client"

import type { PdfRegion, PdfSearchResult } from "../subject-pdf-search"
import { pdfStatementRegion } from "../subject-pdf-target"

export function pdfFragmentViewerHref(result: PdfSearchResult, region?: PdfRegion) {
  const target = region ?? pdfStatementRegion(result) ?? result.candidate.blocks.find((block) =>
    result.decision.blockIds.includes(block.id) || result.decision.partialIds.includes(block.id))?.region
    ?? result.candidate.blocks.find((block) => block.region)?.region
  const params = new URLSearchParams({ file: "", localWorkspace: "1", workspaceFileId: result.fileId, fileName: result.fileName })
  if (target) params.set("fragmentRegion", JSON.stringify(target))
  return `/pdfjs/web/viewer.html?${params}#page=${target?.page ?? 1}&zoom=page-width`
}
