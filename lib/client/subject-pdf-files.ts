"use client"

import { loadPdfLib } from "./text-to-pdf"
import { PDF_BATCH_BYTES, PDF_BATCH_PAGES } from "../subject-pdf-search"

type SplitDocument = {
  getPageCount(): number
  copyPages(source: SplitDocument, indices: number[]): Promise<unknown[]>
  addPage(page: unknown): void
  save(): Promise<Uint8Array<ArrayBuffer>>
}
type SplitLib = { PDFDocument: { load(bytes: ArrayBuffer): Promise<SplitDocument>; create(): Promise<SplitDocument> } }
export type PdfBatch = { pages: number[]; file: File }

export async function* splitPdfBatches(file: File, signal: AbortSignal): AsyncGenerator<PdfBatch | { pages: number[]; error: string }> {
  const { PDFDocument } = await loadPdfLib() as unknown as SplitLib
  const source = await PDFDocument.load(await file.arrayBuffer())
  let start = 0
  while (start < source.getPageCount()) {
    signal.throwIfAborted()
    let count = Math.min(PDF_BATCH_PAGES, source.getPageCount() - start)
    while (count) {
      const document = await PDFDocument.create()
      const indices = Array.from({ length: count }, (_, i) => start + i)
      for (const page of await document.copyPages(source, indices)) document.addPage(page)
      const bytes = await document.save()
      if (bytes.length <= PDF_BATCH_BYTES) {
        yield { pages: indices.map((n) => n + 1), file: new File([bytes], `${file.name}-${start + 1}.pdf`, { type: "application/pdf" }) }
        start += count
        break
      }
      if (count === 1) {
        yield { pages: [start + 1], error: `La página ${start + 1} supera 3 MiB y no pudo procesarse.` }
        start++
        break
      }
      count = Math.max(1, Math.floor(count / 2))
    }
  }
}

export async function pdfHash(file: File) {
  const hash = await crypto.subtle.digest("SHA-256", await file.arrayBuffer())
  return Array.from(new Uint8Array(hash), (n) => n.toString(16).padStart(2, "0")).join("")
}
