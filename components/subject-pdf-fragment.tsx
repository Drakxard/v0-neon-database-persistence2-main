"use client"

import { useEffect, useState } from "react"
import { renderPdfFragment } from "@/lib/client/subject-pdf-crops"
import { correctPdfFragment } from "@/lib/client/subject-pdf-corrections"
import { pdfFragmentViewerHref } from "@/lib/client/subject-pdf-viewer"
import { usePdfLongPress } from "@/hooks/use-pdf-long-press"
import type { PdfRegion, PdfSearchResult } from "@/lib/subject-pdf-search"

type Crop = { page: number; url: string; region: PdfRegion; id: string }
function PdfCrop({ image, result, removed, failed }: {
  image: Crop; result: PdfSearchResult; removed: () => void; failed: (error: unknown) => void
}) {
  const press = usePdfLongPress(async () => { await correctPdfFragment(result, image.region); removed() }, failed)
  return <figure {...press} className="mx-auto max-w-full select-none" data-pdf-crop={image.id}
    title="Mantené presionado un segundo para quitar este recorte">
    {/* eslint-disable-next-line @next/next/no-img-element */}
    <img src={image.url} alt={`${result.title}, página ${image.page}`} draggable={false} className="max-w-full" />
    <a href={pdfFragmentViewerHref(result, image.region)} target="_blank" rel="noopener noreferrer"
      onPointerDown={(event) => event.stopPropagation()} className="block text-xs text-neutral-500 underline">Ver en PDF</a>
  </figure>
}

export function SubjectPdfFragment({ result }: { result: PdfSearchResult }) {
  const [images, setImages] = useState<Crop[]>([])
  const [progress, setProgress] = useState("Abriendo fragmento…")
  const [error, setError] = useState("")
  const [warnings, setWarnings] = useState<string[]>([])
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    let urls: string[] = []
    setImages([]); setError(""); setWarnings([]); setProgress("Abriendo fragmento…")
    void renderPdfFragment(result, controller.signal, (text) => { if (!controller.signal.aborted) setProgress(text) })
      .then((next) => {
        urls = next.images.map((image) => image.url)
        if (controller.signal.aborted) { urls.forEach((url) => URL.revokeObjectURL(url)); return }
        setImages(next.images); setWarnings(next.warnings); setProgress("")
      }).catch((failure) => { if (!controller.signal.aborted) { setError(failure instanceof Error ? failure.message : "No se pudo abrir el fragmento."); setProgress("") } })
    return () => { controller.abort(); urls.forEach((url) => URL.revokeObjectURL(url)) }
  }, [result, attempt])
  return <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto py-4" data-voice-pdf-fragment>
    <h2 className="text-xl">{result.title}</h2>
    <a href={pdfFragmentViewerHref(result, images[0]?.region)} target="_blank" rel="noopener noreferrer"
      className="self-start text-sm underline">Abrir PDF original ↗</a>
    {progress && <p role="status">{progress}</p>}
    {images.map((image) => <PdfCrop key={image.id} image={image} result={result}
      removed={() => setImages((items) => items.filter((item) => item.id !== image.id))}
      failed={(failure) => setError(failure instanceof Error ? failure.message : "No se pudo guardar la corrección.")} />)}
    {warnings.map((warning, index) => <p key={index} role="status" className="text-sm text-neutral-600">{warning}</p>)}
    {!progress && (error || warnings.length > 0) && <div>
      {error && <p role="alert">{error}</p>}
      <button type="button" className="mt-3 rounded-lg border px-4 py-2" onClick={() => setAttempt((n) => n + 1)}>Reintentar fragmento</button>
    </div>}
  </div>
}
