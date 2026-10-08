"use client"

import type { PdfRegion, PdfSearchResult } from "../subject-pdf-search"
import { inPdfCacheQueue, pdfWorkspaceRoot, readPdfCache, writePdfCache } from "./subject-pdf-cache"
import { pdfHash } from "./subject-pdf-files"

type Correction = { hidden?: boolean; removedRegions: string[] }
export const pdfRegionId = (region: PdfRegion) => JSON.stringify(region)
async function correctionPath(result: PdfSearchResult) {
  const key = await pdfHash(new File([JSON.stringify([result.query, result.candidate.anchorIds])], "correction.txt"))
  return `manifests/subject-voice/pdf/corrections-v1/${result.hash}/${key}.json`
}
export async function readPdfCorrection(result: PdfSearchResult): Promise<Correction> {
  return await readPdfCache<Correction>(await pdfWorkspaceRoot(), await correctionPath(result), { valid: value => Array.isArray(value.removedRegions) && value.removedRegions.every(id => typeof id === "string") && (value.hidden === undefined || typeof value.hidden === "boolean") }) ?? { removedRegions: [] }
}
export async function correctPdfFragment(result: PdfSearchResult, region?: PdfRegion) {
  const root = await pdfWorkspaceRoot(), path = await correctionPath(result)
  return inPdfCacheQueue(root, path, async () => {
    const state = await readPdfCache<Correction>(root, path) ?? { removedRegions: [] }
    if (region) state.removedRegions = [...new Set([...state.removedRegions, pdfRegionId(region)])]
    else state.hidden = true
    await writePdfCache(root, path, state)
  })
}
