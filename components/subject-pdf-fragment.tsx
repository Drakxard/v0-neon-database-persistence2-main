"use client"

import { useEffect, useRef, useState } from "react"
import { createRelatedPdf, PdfSourceError, relatedPdfPages, resolvePdfSource } from "@/lib/client/subject-pdf-pages"
import { pdfFragmentViewerHref } from "@/lib/client/subject-pdf-viewer"
import type { PdfRegion, PdfSearchResult } from "@/lib/subject-pdf-search"
import { embeddedStatementRegion } from "@/lib/subject-pdf-target"
import { getReadyWorkspaceHandle, loadWorkspaceHandle, requestWorkspacePermission } from "@/lib/local-workspace-client"

export function SubjectPdfFragment({ result, subjectId, onBack, onUndo, onSearchAgain }: {
  result: PdfSearchResult; subjectId: string; onBack: () => void; onUndo: () => void; onSearchAgain: () => void
}) {
  const [source, setSource] = useState<{ url: string; originalUrl: string; fileId: string | null; target: PdfRegion | null } | null>(null)
  const [error, setError] = useState<Error | null>(null)
  const [loading, setLoading] = useState(true)
  const [attempt, setAttempt] = useState(0)
  const [selected, setSelected] = useState<File | undefined>()
  const iframe = useRef<HTMLIFrameElement>(null), input = useRef<HTMLInputElement>(null)
  async function authorize() {
    try {
      const root = getReadyWorkspaceHandle() ?? await loadWorkspaceHandle()
      if (root && await requestWorkspacePermission(root) === "granted") { setAttempt(n => n + 1); return }
    } catch { /* Keep permission failures actionable inside the viewer. */ }
    setError(new PdfSourceError("permission", "No se autorizó la carpeta. Volvé a seleccionarla desde la aplicación."))
  }
  useEffect(() => {
    const controller = new AbortController(), urls: string[] = []
    setSource(null); setError(null); setLoading(true)
    void (async () => {
      const original = await resolvePdfSource(result, subjectId, controller.signal, selected)
      const subset = await createRelatedPdf(original.file, result, controller.signal)
      controller.signal.throwIfAborted()
      const url = URL.createObjectURL(subset.blob), originalUrl = URL.createObjectURL(original.file)
      urls.push(url, originalUrl); setSource({ url, originalUrl, fileId: original.fileId, target: embeddedStatementRegion(result, subset.pages) })
    })().catch(failure => {
      if (controller.signal.aborted) return
      setError(failure instanceof DOMException && ["NotAllowedError", "SecurityError"].includes(failure.name)
        ? new PdfSourceError("permission", "Volvé a autorizar la carpeta local para abrir el PDF.")
        : failure instanceof DOMException ? new Error("No se pudo leer el PDF en la carpeta local. Reintentá o seleccioná el original.")
        : failure instanceof Error ? failure : new Error("No se pudo abrir el PDF."))
      setLoading(false)
    })
    return () => { controller.abort(); urls.forEach(url => URL.revokeObjectURL(url)) }
  }, [result, subjectId, attempt, selected])
  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (event.origin !== window.location.origin || event.source !== iframe.current?.contentWindow || !event.data) return
      if (event.data.type === "subjectPdfReady") setLoading(false)
      if (event.data.type === "subjectPdfError") { setLoading(false); setError(new Error("No se pudo mostrar el PDF. Reintentá o comprobá el archivo original.")) }
      if (event.data.type === "subjectPdfKey") { if (event.data.key === "undo") onUndo(); else if (event.data.key === "back") onBack() }
    }
    window.addEventListener("message", receive)
    return () => window.removeEventListener("message", receive)
  }, [onBack, onUndo])
  const params = source ? new URLSearchParams({ file: "", embeddedReadOnly: "1", embeddedFile: source.url,
    ...(source.target ? { fragmentRegion: JSON.stringify(source.target) } : {}) }) : null
  return <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden" data-voice-pdf-fragment>
    <a href={source?.fileId ? pdfFragmentViewerHref({ ...result, fileId: source.fileId }) : source ? `${source.originalUrl}#page=${relatedPdfPages(result)[0] ?? 1}` : pdfFragmentViewerHref(result)}
      target="_blank" rel="noopener noreferrer" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-20 focus:bg-white focus:p-2 focus:underline">Abrir PDF original ↗</a>
    {loading && <p role="status" className="absolute left-4 top-4 z-10 rounded bg-white/90 px-3 py-2">Abriendo páginas…</p>}
    {error && <div className="m-5 mr-24"><p role="alert">{error.message}</p>
      <button type="button" className="mt-2 rounded-lg border px-4 py-2" onClick={() => setAttempt(n => n + 1)}>Reintentar PDF</button>
      {((error instanceof PdfSourceError && error.code === "missing") || selected) && <button type="button" className="ml-2 rounded-lg border px-4 py-2" onClick={() => input.current?.click()}>Seleccionar PDF original</button>}
      {error instanceof PdfSourceError && error.code === "permission" && <button type="button" className="ml-2 rounded-lg border px-4 py-2" onClick={() => void authorize()}>Autorizar carpeta</button>}
      {error instanceof PdfSourceError && ["changed", "invalid"].includes(error.code) && <button type="button" className="ml-2 rounded-lg border px-4 py-2" onClick={onSearchAgain}>Volver a buscar</button>}
    </div>}
    <input ref={input} type="file" accept="application/pdf,.pdf" className="hidden" aria-label="Seleccionar PDF original" onChange={event => { const file = event.target.files?.[0]; event.target.value = ""; if (file) setSelected(file) }} />
    {params && !error && <iframe key={source!.url} ref={iframe} title={`Páginas de ${result.title}`} data-voice-pdf-frame
      src={`/pdfjs/web/viewer.html?${params}#zoom=page-width`} className="min-h-0 w-full flex-1 border-0" />}
  </div>
}
