"use client"

import { useEffect, useLayoutEffect, useRef, useState } from "react"
import { PdfSourceError, relatedPdfPages, resolvePdfSource } from "@/lib/client/subject-pdf-pages"
import { pdfFragmentViewerHref } from "@/lib/client/subject-pdf-viewer"
import type { PdfRegion, PdfSearchResult } from "@/lib/subject-pdf-search"
import { pdfStatementRegion } from "@/lib/subject-pdf-target"
import { renderRelatedPdfImages, retainPdfImageUrl } from "@/lib/client/subject-pdf-images"
import { ExternalLink } from "lucide-react"
import { getReadyWorkspaceHandle, loadWorkspaceHandle, requestWorkspacePermission } from "@/lib/local-workspace-client"

export function SubjectPdfFragment({ result, subjectId, onBack, onUndo, onSearchAgain, active = true, onPrepared }: {
  result: PdfSearchResult; subjectId: string; onBack: () => void; onUndo: () => void; onSearchAgain: () => void; active?: boolean; onPrepared?: () => void
}) {
  const [source, setSource] = useState<{ images: { url: string; width: number; height: number; page: number }[]; originalUrl: string; fileId: string | null; target: PdfRegion | null } | null>(null)
  const [error, setError] = useState<Error | null>(null)
  const [loading, setLoading] = useState(true)
  const [attempt, setAttempt] = useState(0)
  const [selected, setSelected] = useState<File | undefined>()
  const scroller = useRef<HTMLDivElement>(null), input = useRef<HTMLInputElement>(null)
  const [positioned, setPositioned] = useState(false)
  useLayoutEffect(() => {
    if (!source || !scroller.current) return
    const container = scroller.current
    const target = source.target
    const position = () => {
      const page = container.querySelector<HTMLElement>(`[data-pdf-image-page="${target?.page ?? source.images[0]?.page}"]`)
      if (page) container.scrollTop = page.offsetTop + page.clientHeight * Math.max(0, (target?.y1 ?? 0) - 0.025)
    }
    position()
    setPositioned(true)
    const observer = new ResizeObserver(position)
    observer.observe(container)
    return () => observer.disconnect()
  }, [source, active])
  useEffect(() => { if (!loading) onPrepared?.() }, [loading, onPrepared])
  useEffect(() => {
    if (!active) return
    const key = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || event.altKey || event.shiftKey) return
      const element = event.target as HTMLElement | null
      if (element?.closest('input, textarea, select, [contenteditable="true"]')) return
      if (!event.ctrlKey && !event.metaKey && (event.key === "Escape" || event.key === "Backspace")) { event.preventDefault(); event.stopPropagation(); onBack() }
      else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") { event.preventDefault(); event.stopPropagation(); onUndo() }
    }
    window.addEventListener("keydown", key, true)
    return () => window.removeEventListener("keydown", key, true)
  }, [active, onBack, onUndo])
  async function authorize() {
    try {
      const root = getReadyWorkspaceHandle() ?? await loadWorkspaceHandle()
      if (root && await requestWorkspacePermission(root) === "granted") { setAttempt(n => n + 1); return }
    } catch { /* Keep permission failures actionable inside the viewer. */ }
    setError(new PdfSourceError("permission", "No se autorizó la carpeta. Volvé a seleccionarla desde la aplicación."))
  }
  useEffect(() => {
    const controller = new AbortController(), urls: string[] = [], releaseImages: (() => void)[] = []
    setSource(null); setError(null); setLoading(true); setPositioned(false)
    void (async () => {
      const original = await resolvePdfSource(result, subjectId, controller.signal, selected)
      const rendered = await renderRelatedPdfImages(original.file, result, controller.signal)
      controller.signal.throwIfAborted()
      const images = rendered.map(image => {
        const lease = retainPdfImageUrl(image.blob)
        releaseImages.push(lease.release)
        return { ...image, url: lease.url }
      })
      const originalUrl = URL.createObjectURL(original.file)
      urls.push(originalUrl)
      await Promise.all(images.map(async image => {
        const decoded = new Image()
        decoded.src = image.url
        await decoded.decode()
      }))
      controller.signal.throwIfAborted()
      setSource({ images, originalUrl, fileId: original.fileId, target: pdfStatementRegion(result) })
      setLoading(false)
    })().catch(failure => {
      if (controller.signal.aborted) return
      setError(failure instanceof DOMException && ["NotAllowedError", "SecurityError"].includes(failure.name)
        ? new PdfSourceError("permission", "Volvé a autorizar la carpeta local para abrir el PDF.")
        : failure instanceof DOMException ? new Error("No se pudo leer el PDF en la carpeta local. Reintentá o seleccioná el original.")
        : failure instanceof Error ? failure : new Error("No se pudo abrir el PDF."))
      setLoading(false)
    })
    return () => { controller.abort(); releaseImages.forEach(release => release()); urls.forEach(url => URL.revokeObjectURL(url)) }
  }, [result, subjectId, attempt, selected])
  return <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden" data-pdf-view data-voice-pdf-fragment={active ? "" : undefined}>
    <a href={source?.fileId ? pdfFragmentViewerHref({ ...result, fileId: source.fileId }) : source ? `${source.originalUrl}#page=${pdfStatementRegion(result)?.page ?? relatedPdfPages(result)[0] ?? 1}` : pdfFragmentViewerHref(result)}
      target="_blank" rel="noopener noreferrer" aria-label="Abrir PDF original" title="Abrir PDF original" className="absolute left-4 top-4 z-20 rounded-full bg-white/90 p-3 shadow hover:bg-white"><ExternalLink size={22} /></a>
    {active && loading && <p role="status" className="absolute left-16 top-4 z-10 rounded bg-white/90 px-3 py-2">Abriendo páginas…</p>}
    {active && error && <div className="m-5 mr-24"><p role="alert">{error.message}</p>
      <button type="button" className="mt-2 rounded-lg border px-4 py-2" onClick={() => setAttempt(n => n + 1)}>Reintentar PDF</button>
      {((error instanceof PdfSourceError && error.code === "missing") || selected) && <button type="button" className="ml-2 rounded-lg border px-4 py-2" onClick={() => input.current?.click()}>Seleccionar PDF original</button>}
      {error instanceof PdfSourceError && error.code === "permission" && <button type="button" className="ml-2 rounded-lg border px-4 py-2" onClick={() => void authorize()}>Autorizar carpeta</button>}
      {error instanceof PdfSourceError && ["changed", "invalid"].includes(error.code) && <button type="button" className="ml-2 rounded-lg border px-4 py-2" onClick={onSearchAgain}>Volver a buscar</button>}
    </div>}
    <input ref={input} type="file" accept="application/pdf,.pdf" className="hidden" aria-label="Seleccionar PDF original" onChange={event => { const file = event.target.files?.[0]; event.target.value = ""; if (file) setSelected(file) }} />
    {source && !error && <div ref={scroller} data-pdf-image-scroll data-pdf-ready={positioned ? "true" : undefined}
      style={{ overflowY: "auto", minHeight: 0, flex: 1, height: "100%", width: "100%", boxSizing: "border-box", position: "relative", opacity: positioned ? 1 : 0, paddingBottom: "calc(100vh - 24px)" }}>
      {source.images.map(image => <img key={image.page} src={image.url} alt={`Página ${image.page} de ${result.fileName}`} data-pdf-image-page={image.page}
        width={image.width} height={image.height} draggable={false} style={{ display: "block", width: "100%", height: "auto" }} />)}
    </div>}
  </div>
}
