import { normalizePdfQuery, type PdfRegion, type PdfSearchResult } from "./subject-pdf-search.ts"

// The displayed title identifies the statement; neighboring accepted blocks may precede it.
export function pdfStatementRegion(result: PdfSearchResult): PdfRegion | null {
  const accepted = new Set([...result.decision.blockIds, ...result.decision.partialIds])
  const blocks = result.candidate.blocks.filter(block => accepted.has(block.id) && block.region)
  const title = normalizePdfQuery(result.title)
  const titled = blocks.find(block => {
    const text = normalizePdfQuery(block.text)
    return text && (title === text || title.startsWith(text + " ") || text.startsWith(title + " "))
  })
  return (titled ?? blocks.find(block => result.candidate.anchorIds.includes(block.id)) ?? blocks[0])?.region ?? null
}

export function embeddedStatementRegion(result: PdfSearchResult, pages: number[]): PdfRegion | null {
  const region = pdfStatementRegion(result)
  const index = region ? pages.indexOf(region.page) : -1
  return region && index >= 0 ? { ...region, page: index + 1 } : null
}
