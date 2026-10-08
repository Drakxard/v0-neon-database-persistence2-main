"use client"

import { getWorkspaceFile, listLocalSubjectDayMaterials, listLocalSubjectWeekNumbersWithContent } from "../local-workspace-data"
import type { PdfSearchResult } from "../subject-pdf-search"
import { pdfHash } from "./subject-pdf-files"
import { loadPdfLib } from "./text-to-pdf"
import { pdfWorkspaceRoot, readPdfCrop, writePdfCrop } from "./subject-pdf-cache"

export class PdfSourceError extends Error {
  constructor(public code: "missing" | "changed" | "permission" | "invalid", message: string) { super(message) }
}
export function relatedPdfPages(result: PdfSearchResult) {
  const accepted = new Set([...result.decision.blockIds, ...result.decision.partialIds])
  return [...new Set(result.candidate.blocks.filter(block => accepted.has(block.id)).map(block => block.page))]
    .filter(page => Number.isSafeInteger(page) && page > 0).sort((a, b) => a - b)
}
export async function resolvePdfSource(result: PdfSearchResult, subjectId: string, signal: AbortSignal, selected?: File) {
  if (!/^[a-f0-9]{64}$/.test(result.hash)) throw new PdfSourceError("invalid", "El resultado de búsqueda no es válido. Volvé a buscar.")
  const recoveredPath = `subject-voice/pdf-sources/${encodeURIComponent(subjectId).replace(/\./g, "%2E")}/${result.hash}.pdf`
  if (selected) {
    if (await pdfHash(selected) !== result.hash) throw new PdfSourceError("changed", "Ese archivo no coincide con el PDF del resultado. Seleccioná el original o volvé a buscar.")
    signal.throwIfAborted()
    await writePdfCrop(await pdfWorkspaceRoot(), recoveredPath, selected)
    return { file: selected, fileId: null }
  }
  try {
    const file = await getWorkspaceFile(result.fileId)
    if (await pdfHash(file) !== result.hash) throw new PdfSourceError("changed", "El PDF cambió. Volvé a buscar para abrir su nueva versión.")
    return { file, fileId: result.fileId }
  } catch (error) {
    if (error instanceof PdfSourceError) throw error
    if (error instanceof DOMException && ["NotAllowedError", "SecurityError"].includes(error.name))
      throw new PdfSourceError("permission", "Volvé a autorizar la carpeta local para abrir el PDF.")
    if (error instanceof Error && /permiso|autoriza|carpeta local seleccionada/i.test(error.message))
      throw new PdfSourceError("permission", "Volvé a autorizar la carpeta local para abrir el PDF.")
    if (!(error instanceof DOMException && error.name === "NotFoundError")) throw error
  }
  const recovered = await readPdfCrop(await pdfWorkspaceRoot(), recoveredPath)
  if (recovered && await pdfHash(recovered) === result.hash) return { file: recovered, fileId: null }
  for (const weekNumber of await listLocalSubjectWeekNumbersWithContent(subjectId)) {
    for (const material of await listLocalSubjectDayMaterials({ subjectId, weekNumber })) {
      signal.throwIfAborted()
      if (material.drive_mime_type !== "application/pdf" && !/\.pdf$/i.test(material.file_name)) continue
      try {
        const file = await getWorkspaceFile(material.drive_file_id)
        if (await pdfHash(file) === result.hash) return { file, fileId: material.drive_file_id }
      } catch (error) {
        if (!(error instanceof DOMException && error.name === "NotFoundError")) throw error
      }
    }
  }
  throw new PdfSourceError("missing", "No se encontró el PDF original en la carpeta local. Seleccioná el mismo archivo para abrirlo.")
}
type Document = {
  getPageCount(): number; copyPages(source: Document, indexes: number[]): Promise<unknown[]>;
  addPage(page: unknown): void; save(): Promise<Uint8Array<ArrayBuffer>>
}
export async function createRelatedPdf(file: File, result: PdfSearchResult, signal: AbortSignal) {
  const pages = relatedPdfPages(result)
  if (!pages.length) throw new PdfSourceError("invalid", "Este resultado no tiene páginas relacionadas. Volvé a buscar.")
  const { PDFDocument } = await loadPdfLib() as unknown as { PDFDocument: { load(bytes: ArrayBuffer): Promise<Document>; create(): Promise<Document> } }
  signal.throwIfAborted()
  let source: Document
  try { source = await PDFDocument.load(await file.arrayBuffer()) }
  catch { throw new PdfSourceError("invalid", "El archivo PDF es inválido o está protegido. Comprobá el original.") }
  if (pages.some(page => page > source.getPageCount())) throw new PdfSourceError("invalid", "Las páginas del resultado no corresponden al PDF. Volvé a buscar.")
  const document = await PDFDocument.create()
  for (const page of await document.copyPages(source, pages.map(page => page - 1))) document.addPage(page)
  const bytes = await document.save()
  signal.throwIfAborted()
  return { blob: new Blob([bytes], { type: "application/pdf" }), pages }
}
