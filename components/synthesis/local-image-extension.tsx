"use client"

import { useEffect, useRef, useState } from "react"
import Image from "@tiptap/extension-image"
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from "@tiptap/react"
import { loadSynthesisImage, localImageId } from "@/lib/client/synthesis-images"

function LocalImageView({ node, selected, editor, updateAttributes }: NodeViewProps) {
  const [url, setUrl] = useState<string | null>(null)
  const imageRef = useRef<HTMLImageElement>(null)
  const id = localImageId(node.attrs.src)

  const resize = (factor: number) => {
    const image = imageRef.current
    if (!image) return
    const availableWidth = image.closest<HTMLElement>(".synthesis-local-image")?.clientWidth ?? 2048
    const width = Math.min(availableWidth, Math.max(24, Math.round(image.getBoundingClientRect().width * factor)))
    updateAttributes({ width, height: null })
  }

  useEffect(() => {
    let active = true
    let objectUrl: string | null = null
    if (!id) { setUrl(typeof node.attrs.src === "string" ? node.attrs.src : null); return }
    void loadSynthesisImage(id).then((blob) => {
      if (!active || !blob) return
      objectUrl = URL.createObjectURL(blob)
      setUrl(objectUrl)
    }).catch(() => setUrl(null))
    return () => { active = false; if (objectUrl) URL.revokeObjectURL(objectUrl) }
  }, [id, node.attrs.src])

  return (
    <NodeViewWrapper className={selected ? "synthesis-local-image is-selected" : "synthesis-local-image"}
      data-text-align={node.attrs.textAlign ?? "left"} data-drag-handle="" draggable={editor.isEditable} contentEditable={false}>
      <div className="synthesis-image-frame">
      {url ? <img ref={imageRef} src={url} draggable={false} style={{ width: node.attrs.width ? `${Number(node.attrs.width)}px` : undefined }} alt={node.attrs.alt ?? "Imagen de Síntesis"} title={node.attrs.title ?? undefined} /> : <div role="img" aria-label="Imagen no disponible en este dispositivo" className="synthesis-missing-image">Imagen disponible solo en el dispositivo donde se agregó</div>}
      {selected && url && editor.isEditable ? <div className="synthesis-image-size-controls" role="group" aria-label="Tamaño de la imagen"
        onMouseDown={(event) => { event.preventDefault(); event.stopPropagation() }} onDragStart={(event) => event.preventDefault()}>
        <button type="button" draggable={false} aria-label="Reducir imagen" title="Reducir imagen" onClick={(event) => { event.stopPropagation(); resize(1 / 1.2) }}>−</button>
        <button type="button" draggable={false} aria-label="Aumentar imagen" title="Aumentar imagen" onClick={(event) => { event.stopPropagation(); resize(1.2) }}>+</button>
      </div> : null}
      </div>
    </NodeViewWrapper>
  )
}

export const LocalImage = Image.extend({
  addNodeView() {
    return ReactNodeViewRenderer(LocalImageView)
  },
})
