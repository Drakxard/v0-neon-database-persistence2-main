"use client"

import { useEffect, useState } from "react"
import Image from "@tiptap/extension-image"
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from "@tiptap/react"
import { loadSynthesisImage, localImageId } from "@/lib/client/synthesis-images"

function LocalImageView({ node, selected, editor }: NodeViewProps) {
  const [url, setUrl] = useState<string | null>(null)
  const id = localImageId(node.attrs.src)

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
      {url ? <img src={url} draggable={false} alt={node.attrs.alt ?? "Imagen de Síntesis"} title={node.attrs.title ?? undefined} /> : <div role="img" aria-label="Imagen no disponible en este dispositivo" className="synthesis-missing-image">Imagen disponible solo en el dispositivo donde se agregó</div>}
    </NodeViewWrapper>
  )
}

export const LocalImage = Image.extend({
  addNodeView() {
    return ReactNodeViewRenderer(LocalImageView)
  },
})
