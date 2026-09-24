const XHTML_NAMESPACE = "http://www.w3.org/1999/xhtml"
const EDITOR_CONTROLS = ".synthesis-image-size-controls, .column-resize-handle, .ProseMirror-gapcursor, .ProseMirror-widget"

function copyStyle(source: CSSStyleDeclaration, target: CSSStyleDeclaration) {
  for (const property of Array.from(source)) {
    if (!property.startsWith("--")) target.setProperty(property, source.getPropertyValue(property))
  }
  target.setProperty("animation", "none")
  target.setProperty("transition", "none")
  target.setProperty("caret-color", "transparent")
}

async function imageDataUrl(src: string): Promise<string> {
  if (src.startsWith("data:")) return src
  const response = await fetch(src)
  if (!response.ok) throw new Error("No se pudo incrustar una imagen de Síntesis.")
  const blob = await response.blob()
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })
}

// Like Secuencial's exportTextHtml/exportShape, serialize XHTML inside a
// foreignObject. Let the browser lay out rich text instead of estimating SVG
// text baselines and losing tables, lists, highlights and inline formatting.
export async function buildSynthesisEditorSvg(source: HTMLElement): Promise<string> {
  await document.fonts.ready
  await Promise.all(Array.from(source.querySelectorAll("img"), (image) => image.decode()))

  const clone = source.cloneNode(true) as HTMLElement
  const originals = [source, ...Array.from(source.querySelectorAll<HTMLElement>("*"))]
  const copies = [clone, ...Array.from(clone.querySelectorAll<HTMLElement>("*"))]
  const pseudoRules: string[] = []
  const images = new Map<string, Promise<string>>()
  const pendingImages: Promise<void>[] = []

  originals.forEach((original, index) => {
    const copy = copies[index]
    if (original.closest(EDITOR_CONTROLS)) {
      copy.remove()
      return
    }
    if (copy.style) {
      copyStyle(getComputedStyle(original), copy.style)
      // Selection outlines are editor UI, not document formatting.
      copy.style.outline = "none"
    }
    for (const attribute of Array.from(copy.attributes)) {
      if (/^(contenteditable|draggable|tabindex|autofocus|id)$/i.test(attribute.name) || /^on/i.test(attribute.name)) {
        copy.removeAttribute(attribute.name)
      }
    }
    copy.setAttribute("data-svg-node", String(index))
    for (const pseudo of ["::before", "::after"]) {
      if (original.classList.contains("selectedCell")) continue
      const style = getComputedStyle(original, pseudo)
      if (style.content === "none" || style.content === "normal") continue
      const declaration = document.createElement("span").style
      copyStyle(style, declaration)
      pseudoRules.push(`[data-svg-node="${index}"]${pseudo}{${declaration.cssText}}`)
    }
    if (original instanceof HTMLInputElement && original.checked) copy.setAttribute("checked", "checked")
    if (original instanceof HTMLImageElement) {
      const src = original.currentSrc || original.src
      if (!images.has(src)) images.set(src, imageDataUrl(src))
      pendingImages.push(images.get(src)!.then((dataUrl) => {
        copy.setAttribute("src", dataUrl)
        copy.removeAttribute("srcset")
        copy.removeAttribute("sizes")
        copy.removeAttribute("loading")
      }))
    }
    if (original.classList.contains("tableWrapper")) {
      copy.style.overflow = "visible"
    }
  })
  await Promise.all(pendingImages)

  const width = Math.max(1, Math.ceil(source.scrollWidth), source.offsetWidth)
  const height = Math.max(1, Math.ceil(source.scrollHeight), source.offsetHeight)
  clone.setAttribute("xmlns", XHTML_NAMESPACE)
  Object.assign(clone.style, {
    boxSizing: "border-box", width: `${source.offsetWidth}px`, maxWidth: "none",
    height: `${height}px`, maxHeight: "none", margin: "0", position: "relative",
    top: "auto", left: "auto", transform: "none", overflow: "visible",
  })
  if (pseudoRules.length) {
    const style = document.createElementNS(XHTML_NAMESPACE, "style")
    style.textContent = pseudoRules.join("\n")
    clone.prepend(style)
  }
  const html = new XMLSerializer().serializeToString(clone)
  return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="100%" height="100%" fill="#fffdf8"/><foreignObject x="0" y="0" width="${width}" height="${height}">${html}</foreignObject></svg>`
}

export async function exportSynthesisEditorSvg() {
  const source = document.querySelector<HTMLElement>(".simple-editor-wrapper .tiptap")
  if (!source) return
  const svg = await buildSynthesisEditorSvg(source)
  const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml;charset=utf-8" }))
  const link = document.createElement("a")
  link.href = url
  link.download = "sintesis.svg"
  document.body.append(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}
