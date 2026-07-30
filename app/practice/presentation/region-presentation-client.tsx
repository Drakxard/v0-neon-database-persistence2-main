"use client"

import { useEffect, useState } from "react"
import { Loader2 } from "lucide-react"

import type { MaterialTagRegion, StudyTag } from "@/lib/study-types"

type RenderedRegion = MaterialTagRegion & {
  dataUrl: string
  tag: StudyTag
}

export function RegionPresentationClient({
  materialId,
  requestedTagIds,
}: {
  materialId: number
  requestedTagIds: number[]
}) {
  const [items, setItems] = useState<RenderedRegion[]>([])
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    const objectUrls: string[] = []

    const load = async () => {
      if (!Number.isInteger(materialId)) throw new Error("El material solicitado no es válido.")

      const tagsResponse = await fetch(`/api/subject-day-materials/${materialId}/tags`, { cache: "no-store" })
      if (!tagsResponse.ok) throw new Error("No se pudieron cargar los tags del material.")
      const assignedTags = await tagsResponse.json() as StudyTag[]
      const requested = new Set(requestedTagIds)
      const tags = requested.size > 0 ? assignedTags.filter((tag) => requested.has(tag.id)) : assignedTags

      const regionGroups = await Promise.all(tags.map(async (tag) => {
        const response = await fetch(`/api/subject-day-materials/${materialId}/tags/${tag.id}/regions`, { cache: "no-store" })
        if (!response.ok) throw new Error(`No se pudieron cargar las regiones de #${tag.name}.`)
        return { tag, regions: await response.json() as MaterialTagRegion[] }
      }))
      const regions = regionGroups
        .flatMap(({ tag, regions: tagRegions }) => tagRegions.map((region) => ({ ...region, tag })))
        .sort((left, right) =>
          left.pageNumber - right.pageNumber ||
          left.y1 - right.y1 ||
          left.x1 - right.x1 ||
          left.orderIndex - right.orderIndex
        )
      if (regions.length === 0) {
        if (!cancelled) setItems([])
        return
      }

      const fileResponse = await fetch(`/api/subject-day-materials/${materialId}/file`, { cache: "no-store" })
      if (!fileResponse.ok) throw new Error("No se pudo cargar el PDF original.")
      const bytes = new Uint8Array(await fileResponse.arrayBuffer())
      const pdfjs = await import("pdfjs-dist/build/pdf.mjs")
      pdfjs.GlobalWorkerOptions.workerSrc = "/pdfjs/build/pdf.worker.mjs"
      const document = await pdfjs.getDocument({ data: bytes }).promise
      const pageCache = new Map<string, HTMLCanvasElement>()
      const rendered: RenderedRegion[] = []

      for (const region of regions) {
        const cacheKey = `${region.pageNumber}:${region.pageRotation}`
        let pageCanvas = pageCache.get(cacheKey)
        if (!pageCanvas) {
          const page = await document.getPage(region.pageNumber)
          const viewport = page.getViewport({ scale: 2, rotation: region.pageRotation })
          pageCanvas = window.document.createElement("canvas")
          pageCanvas.width = Math.ceil(viewport.width)
          pageCanvas.height = Math.ceil(viewport.height)
          const context = pageCanvas.getContext("2d")
          if (!context) throw new Error("El navegador no pudo preparar el recorte.")
          await page.render({ canvas: pageCanvas, canvasContext: context, viewport }).promise
          pageCache.set(cacheKey, pageCanvas)
        }

        const left = Math.min(region.x1, region.x2)
        const top = Math.min(region.y1, region.y2)
        const width = Math.abs(region.x2 - region.x1)
        const height = Math.abs(region.y2 - region.y1)
        const sourceX = Math.floor(left * pageCanvas.width)
        const sourceY = Math.floor(top * pageCanvas.height)
        const sourceWidth = Math.max(1, Math.ceil(width * pageCanvas.width))
        const sourceHeight = Math.max(1, Math.ceil(height * pageCanvas.height))
        const crop = window.document.createElement("canvas")
        crop.width = sourceWidth
        crop.height = sourceHeight
        crop.getContext("2d")?.drawImage(
          pageCanvas,
          sourceX,
          sourceY,
          sourceWidth,
          sourceHeight,
          0,
          0,
          sourceWidth,
          sourceHeight
        )
        const blob = await new Promise<Blob | null>((resolve) => crop.toBlob(resolve, "image/png"))
        if (!blob) continue
        const dataUrl = URL.createObjectURL(blob)
        objectUrls.push(dataUrl)
        rendered.push({ ...region, dataUrl })
      }

      await document.destroy()
      if (!cancelled) setItems(rendered)
    }

    void load()
      .catch((loadError) => {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : "No se pudo preparar la presentación.")
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
      objectUrls.forEach((url) => URL.revokeObjectURL(url))
    }
  }, [materialId, requestedTagIds])

  return (
    <main className="min-h-screen bg-slate-950 px-4 py-6 text-white sm:px-8">
      <header className="mx-auto mb-6 flex max-w-5xl items-center justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.24em] text-slate-400">Presentación</p>
          <h1 className="mt-1 text-xl font-semibold">Recortes etiquetados</h1>
        </div>
        <button type="button" onClick={() => window.close()} className="rounded-lg border border-white/15 px-3 py-2 text-sm">
          Cerrar
        </button>
      </header>

      {loading ? (
        <div className="flex min-h-[60vh] items-center justify-center gap-3 text-slate-300">
          <Loader2 className="h-5 w-5 animate-spin" /> Preparando recortes…
        </div>
      ) : error ? (
        <p className="mx-auto max-w-xl rounded-xl border border-red-400/30 bg-red-500/10 p-4 text-red-200">{error}</p>
      ) : items.length === 0 ? (
        <p className="mx-auto max-w-xl rounded-xl border border-white/10 bg-white/5 p-4 text-slate-300">
          No hay regiones guardadas para los tags seleccionados.
        </p>
      ) : (
        <div className="mx-auto grid max-w-5xl gap-6">
          {items.map((item, index) => (
            <article key={`${item.tagId}-${item.pageNumber}-${item.orderIndex}-${index}`} className="overflow-hidden rounded-2xl border border-white/10 bg-white">
              <div className="flex items-center justify-between bg-slate-900 px-4 py-2 text-xs text-white">
                <span className="rounded-full border px-2 py-1" style={{ borderColor: item.tag.color }}>#{item.tag.name}</span>
                <span className="text-slate-400">Página {item.pageNumber}</span>
              </div>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={item.dataUrl} alt={`Recorte de #${item.tag.name}, página ${item.pageNumber}`} className="h-auto w-full" />
            </article>
          ))}
        </div>
      )}
    </main>
  )
}
