"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { ChevronLeft, ChevronRight, Expand, Loader2, Minus, Plus, Shrink } from "lucide-react"
import { Document, Page, pdfjs } from "react-pdf"

import { Button } from "@/components/ui/button"
import { preloadPracticePdf, releasePracticePdf } from "./pdf-memory-cache"

import "react-pdf/dist/Page/AnnotationLayer.css"
import "react-pdf/dist/Page/TextLayer.css"

pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString()

type MaterialContext = {
  id: number
  fileName: string
  sessionDate: string
  subjectName: string
}

const MIN_ZOOM = 0.9
const MAX_ZOOM = 2.6
const ZOOM_STEP = 0.2

export function MobilePracticeViewer({ material }: { material: MaterialContext }) {
  const router = useRouter()
  const rootRef = useRef<HTMLDivElement | null>(null)
  const contentRef = useRef<HTMLDivElement | null>(null)

  const [blobUrl, setBlobUrl] = useState("")
  const [pageNumber, setPageNumber] = useState(1)
  const [pageCount, setPageCount] = useState(0)
  const [zoom, setZoom] = useState(1)
  const [fitWidth, setFitWidth] = useState(0)
  const [isLoading, setIsLoading] = useState(true)
  const [isRenderingPage, setIsRenderingPage] = useState(true)
  const [error, setError] = useState("")
  const [isFullscreen, setIsFullscreen] = useState(false)

  const pageLabel = useMemo(() => `${pageNumber}/${pageCount || 1}`, [pageCount, pageNumber])

  useEffect(() => {
    if (!contentRef.current || typeof ResizeObserver === "undefined") return

    const observer = new ResizeObserver((entries) => {
      const nextWidth = entries[0]?.contentRect.width ?? 0
      setFitWidth(Math.max(0, Math.floor(nextWidth - 16)))
    })

    observer.observe(contentRef.current)
    setFitWidth(Math.max(0, Math.floor(contentRef.current.getBoundingClientRect().width - 16)))

    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const onFullscreenChange = () => {
      setIsFullscreen(document.fullscreenElement === rootRef.current)
    }

    document.addEventListener("fullscreenchange", onFullscreenChange)
    return () => document.removeEventListener("fullscreenchange", onFullscreenChange)
  }, [])

  useEffect(() => {
    let cancelled = false

    setBlobUrl("")
    setError("")
    setIsLoading(true)
    setIsRenderingPage(true)

    preloadPracticePdf(material.id, material.fileName)
      .then((cachedPdf) => {
        if (cancelled) return
        setBlobUrl(cachedPdf.blobUrl)
      })
      .catch((loadError) => {
        if (cancelled) return
        console.error("Failed to preload practice PDF:", loadError)
        setError(loadError instanceof Error ? loadError.message : "No se pudo abrir el PDF.")
      })
      .finally(() => {
        if (!cancelled) {
          setIsLoading(false)
        }
      })

    return () => {
      cancelled = true
      releasePracticePdf(material.id)
    }
  }, [material.fileName, material.id])

  const closeViewer = useCallback(() => {
    if (window.history.length > 1) {
      router.back()
      return
    }

    router.push("/")
  }, [router])

  const toggleFullscreen = useCallback(async () => {
    try {
      if (document.fullscreenElement === rootRef.current) {
        await document.exitFullscreen()
        return
      }

      await rootRef.current?.requestFullscreen()
    } catch (fullscreenError) {
      console.error("Failed to toggle fullscreen:", fullscreenError)
    }
  }, [])

  const changeZoom = useCallback((delta: number) => {
    setZoom((currentZoom) => {
      const nextZoom = Number((currentZoom + delta).toFixed(2))
      return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, nextZoom))
    })
  }, [])

  const canGoPrev = pageNumber > 1
  const canGoNext = pageCount > 0 && pageNumber < pageCount

  return (
    <main ref={rootRef} className="min-h-screen bg-neutral-100 text-neutral-950">
      <div className="mx-auto flex min-h-screen w-full max-w-md flex-col bg-white shadow-[0_0_0_1px_rgba(0,0,0,0.06)]">
        <header className="sticky top-0 z-20 border-b border-neutral-200 bg-white/96 px-4 pb-3 pt-[max(env(safe-area-inset-top),0.9rem)] backdrop-blur">
          <div className="flex items-center gap-3">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={closeViewer}
              className="h-10 w-10 rounded-full text-neutral-700 hover:bg-neutral-100"
              aria-label="Volver"
            >
              <ChevronLeft className="h-5 w-5" />
            </Button>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-neutral-900">{material.fileName}</p>
              <p className="truncate text-xs text-neutral-500">{`${material.subjectName} - ${material.sessionDate}`}</p>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={toggleFullscreen}
              className="h-10 w-10 rounded-full text-neutral-700 hover:bg-neutral-100"
              aria-label={isFullscreen ? "Salir de pantalla completa" : "Pantalla completa"}
            >
              {isFullscreen ? <Shrink className="h-4 w-4" /> : <Expand className="h-4 w-4" />}
            </Button>
          </div>

          <div className="mt-3 flex items-center justify-between rounded-2xl bg-neutral-100 px-3 py-2">
            <div className="inline-flex items-center gap-1 rounded-full bg-white p-1 shadow-sm">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => changeZoom(-ZOOM_STEP)}
                disabled={zoom <= MIN_ZOOM}
                className="h-8 w-8 rounded-full text-neutral-700 hover:bg-neutral-100 disabled:text-neutral-300"
                aria-label="Alejar"
              >
                <Minus className="h-4 w-4" />
              </Button>
              <span className="min-w-12 text-center text-xs font-medium text-neutral-700">{Math.round(zoom * 100)}%</span>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => changeZoom(ZOOM_STEP)}
                disabled={zoom >= MAX_ZOOM}
                className="h-8 w-8 rounded-full text-neutral-700 hover:bg-neutral-100 disabled:text-neutral-300"
                aria-label="Acercar"
              >
                <Plus className="h-4 w-4" />
              </Button>
            </div>
            <div className="text-xs font-medium text-neutral-500">{pageLabel}</div>
          </div>
        </header>

        <section ref={contentRef} className="flex flex-1 items-start justify-center overflow-auto bg-neutral-200 px-2 py-4">
          {isLoading ? (
            <div className="flex min-h-[45vh] flex-col items-center justify-center gap-3 text-center text-neutral-600">
              <Loader2 className="h-8 w-8 animate-spin" />
              <div>
                <p className="text-sm font-medium text-neutral-800">Cargando PDF</p>
                <p className="text-xs text-neutral-500">Se abre desde la copia en memoria para evitar pasos extra.</p>
              </div>
            </div>
          ) : error ? (
            <div className="flex min-h-[45vh] max-w-xs flex-col items-center justify-center gap-3 rounded-3xl bg-white px-6 py-8 text-center shadow-sm">
              <p className="text-sm font-semibold text-neutral-900">No se pudo abrir el PDF</p>
              <p className="text-xs text-neutral-500">{error}</p>
            </div>
          ) : blobUrl ? (
            <Document
              file={blobUrl}
              loading={null}
              error={<div className="rounded-3xl bg-white px-6 py-8 text-center text-sm text-neutral-700 shadow-sm">No se pudo leer el PDF.</div>}
              onLoadSuccess={({ numPages }) => {
                setPageCount(numPages)
                setPageNumber((current) => Math.min(Math.max(current, 1), numPages))
                setIsRenderingPage(true)
              }}
              onLoadError={(documentError) => {
                console.error("Failed to load PDF document:", documentError)
                setError(documentError instanceof Error ? documentError.message : "No se pudo leer el PDF.")
              }}
              className="flex justify-center"
            >
              <div className="relative overflow-hidden rounded-[22px] bg-white shadow-[0_6px_20px_rgba(0,0,0,0.10)]">
                <Page
                  key={`${material.id}-${pageNumber}-${zoom}-${fitWidth}`}
                  pageNumber={pageNumber}
                  width={fitWidth || undefined}
                  scale={zoom}
                  loading={null}
                  renderAnnotationLayer={false}
                  renderTextLayer={false}
                  className="max-w-full"
                  onRenderSuccess={() => setIsRenderingPage(false)}
                  onRenderError={(pageError) => {
                    console.error("Failed to render PDF page:", pageError)
                    setError(pageError instanceof Error ? pageError.message : "No se pudo renderizar la pagina.")
                    setIsRenderingPage(false)
                  }}
                />
                {isRenderingPage ? (
                  <div className="absolute inset-0 flex items-center justify-center bg-white/75 backdrop-blur-[1px]">
                    <Loader2 className="h-6 w-6 animate-spin text-neutral-500" />
                  </div>
                ) : null}
              </div>
            </Document>
          ) : null}
        </section>

        <footer className="sticky bottom-0 z-20 border-t border-neutral-200 bg-white/96 px-4 pb-[max(env(safe-area-inset-bottom),1rem)] pt-3 backdrop-blur">
          <div className="flex items-center gap-3">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setIsRenderingPage(true)
                setPageNumber((current) => Math.max(1, current - 1))
              }}
              disabled={!canGoPrev || isLoading}
              className="h-11 flex-1 border-neutral-300 bg-white text-neutral-900 hover:bg-neutral-50"
            >
              <ChevronLeft className="h-4 w-4" />
              Anterior
            </Button>
            <div className="min-w-12 text-center text-xs font-semibold text-neutral-500">{pageLabel}</div>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setIsRenderingPage(true)
                setPageNumber((current) => Math.min(pageCount, current + 1))
              }}
              disabled={!canGoNext || isLoading}
              className="h-11 flex-1 border-neutral-300 bg-white text-neutral-900 hover:bg-neutral-50"
            >
              Siguiente
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </footer>
      </div>
    </main>
  )
}
