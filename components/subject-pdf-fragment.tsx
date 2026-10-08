"use client"

import { useEffect, useState } from "react"
import { renderPdfFragment } from "@/lib/client/subject-pdf-crops"
import type { PdfSearchResult } from "@/lib/subject-pdf-search"

export function SubjectPdfFragment({ result }: { result: PdfSearchResult }) {
  const [images, setImages] = useState<Array<{ page: number; url: string }>>([])
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
        if (!next.images.length) setError("No se pudo delimitar un recorte fiable para este fragmento.")
      }).catch((failure) => { if (!controller.signal.aborted) { setError(failure instanceof Error ? failure.message : "No se pudo abrir el fragmento."); setProgress("") } })
    return () => { controller.abort(); urls.forEach((url) => URL.revokeObjectURL(url)) }
  }, [result, attempt])
  return <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto py-4" data-voice-pdf-fragment>
    <h2 className="text-xl">{result.title}</h2>
    <p className="text-sm text-neutral-600">{result.fileName} · Semana {result.week}</p>
    {progress && <p role="status">{progress}</p>}
    {images.map((image, index) => <figure key={index} className="mx-auto max-w-full">
      {/* Local crop URLs preserve the original PDF typography. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={image.url} alt={`${result.title}, página ${image.page}, fragmento ${index + 1}`} className="max-w-full" />
      <figcaption className="text-sm text-neutral-500">Página {image.page}</figcaption>
    </figure>)}
    {warnings.map((warning, index) => <p key={index} role="status" className="text-sm text-neutral-600">{warning}</p>)}
    {error && <div role="alert"><p>{error}</p><button type="button" className="mt-3 rounded-lg border px-4 py-2" onClick={() => setAttempt((n) => n + 1)}>Reintentar fragmento</button></div>}
  </div>
}
