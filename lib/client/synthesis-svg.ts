import { buildRasterSvg, canvasSvgImage, SVG_RENDER_SCALE } from "../../public/pdfjs/web/raster-svg.mjs"
import { embedSvgFonts } from "./svg-fonts"

// ProseMirror adds src-less <img> caret separators after non-editable inline
// nodes such as formulas. They are editor helpers, not document images.
const EDITOR_CONTROLS = ".synthesis-image-size-controls, .column-resize-handle, .ProseMirror-gapcursor, .ProseMirror-widget, .ProseMirror-separator"
const SVG_NS = "http://www.w3.org/2000/svg"
const TILE_HEIGHT = 2048

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

// Like PDF.js, render at 2x and embed JPEGs in a plain, self-contained SVG.
// HTML is only an intermediate browser render, never part of the downloaded SVG.
export async function buildSynthesisEditorSvg(source: HTMLElement): Promise<string> {
  await document.fonts.ready
  const images = Array.from(source.querySelectorAll("img")).filter((image) => !image.closest(EDITOR_CONTROLS))
  await Promise.all(images.map(async (image, index) => {
    try {
      await image.decode()
    } catch {
      throw new Error(`No se pudo cargar la imagen ${index + 1} de Síntesis. Revisá que esté disponible y volvé a exportar.`)
    }
  }))
  const imageSources = new Map<string, Promise<string>>()
  for (const image of images) {
    const src = image.currentSrc || image.src
    if (!imageSources.has(src)) imageSources.set(src, imageDataUrl(src))
  }
  await Promise.all(imageSources.values())

  const clone = source.cloneNode(true) as HTMLElement
  const originals = [source, ...Array.from(source.querySelectorAll<HTMLElement>("*"))]
  const copies = [clone, ...Array.from(clone.querySelectorAll<HTMLElement>("*"))]
  const pseudoRules: string[] = []
  const families = new Set<string>()

  for (let index = 0; index < originals.length; index++) {
    const original = originals[index]
    const copy = copies[index]
    if (original.closest(EDITOR_CONTROLS)) {
      copy.remove()
      continue
    }
    const computed = getComputedStyle(original)
    families.add(computed.fontFamily)
    if (copy.style) {
      copyStyle(computed, copy.style)
      copy.style.outline = "none"
    }
    for (const attribute of Array.from(copy.attributes)) {
      if (/^(contenteditable|draggable|tabindex|autofocus|id)$/i.test(attribute.name) || /^on/i.test(attribute.name)) {
        copy.removeAttribute(attribute.name)
      }
    }
    copy.removeAttribute("class")
    copy.setAttribute("data-svg-node", String(index))
    for (const pseudo of ["::before", "::after"]) {
      if (original.classList.contains("selectedCell")) continue
      const style = getComputedStyle(original, pseudo)
      if (style.content === "none" || style.content === "normal") continue
      const declaration = document.createElement("span").style
      copyStyle(style, declaration)
      pseudoRules.push(`[data-svg-node="${index}"]${pseudo}{${declaration.cssText}}`)
    }
    if (original.matches('li[data-checked="true"] > label > span')) {
      // Replace the editor's external CSS mask with a native checkmark.
      const check = document.createElementNS(SVG_NS, "svg")
      check.setAttribute("viewBox", "0 0 24 24")
      check.style.cssText = "position:absolute;left:.125em;top:.125em;width:.75em;height:.75em;"
      const path = document.createElementNS(SVG_NS, "path")
      path.setAttribute("d", "M3 12L9 18L21 6")
      path.setAttribute("fill", "none")
      path.setAttribute("stroke", getComputedStyle(original, "::before").backgroundColor)
      path.setAttribute("stroke-width", "3")
      path.setAttribute("stroke-linecap", "round")
      path.setAttribute("stroke-linejoin", "round")
      check.append(path)
      copy.append(check)
      pseudoRules.push(`[data-svg-node="${index}"]::before{content:none!important}`)
    }
    if (original instanceof HTMLInputElement && original.checked) copy.setAttribute("checked", "checked")
    if (original instanceof HTMLImageElement) {
      copy.setAttribute("src", await imageSources.get(original.currentSrc || original.src)!)
      copy.removeAttribute("srcset")
      copy.removeAttribute("sizes")
      copy.removeAttribute("loading")
    }
    if (original.classList.contains("tableWrapper")) copy.style.overflow = "visible"
  }

  const width = Math.max(1, source.scrollWidth, source.offsetWidth)
  const height = Math.max(1, source.scrollHeight, source.offsetHeight)
  Object.assign(clone.style, {
    boxSizing: "border-box", width: `${source.offsetWidth}px`, maxWidth: "none",
    height: `${height}px`, maxHeight: "none", margin: "0", position: "relative",
    top: "auto", left: "auto", transform: "none", overflow: "visible", backgroundColor: "#fffdf8",
  })
  if (pseudoRules.length) {
    const style = document.createElement("style")
    style.textContent = pseudoRules.join("\n")
    clone.prepend(style)
  }

  const svg = document.createElementNS(SVG_NS, "svg")
  svg.setAttribute("width", String(width))
  const content = document.createElementNS(SVG_NS, "foreignObject")
  content.setAttribute("width", String(width))
  content.setAttribute("height", String(height))
  content.append(clone)
  svg.append(content)
  await embedSvgFonts(svg, [...families])

  const canvas = document.createElement("canvas")
  const context = canvas.getContext("2d", { alpha: false })
  if (!context) throw new Error("El navegador no pudo crear el lienzo de exportación.")
  const pages: Array<{ width: number; height: number; image: string }> = []
  try {
    // Short canvases also handle documents beyond the browser's canvas height limit.
    for (let y = 0; y < height; y += TILE_HEIGHT) {
      const tileHeight = Math.min(TILE_HEIGHT, height - y)
      svg.setAttribute("height", String(tileHeight))
      svg.setAttribute("viewBox", `0 0 ${width} ${tileHeight}`)
      content.setAttribute("y", String(-y))
      const image = new Image()
      // PDF/clipboard text can contain invisible characters accepted by HTML
      // but forbidden in XML 1.0. Clean only the serialized export, preserving
      // the editor, valid whitespace, mathematical symbols and surrogate pairs.
      const serialized = new XMLSerializer().serializeToString(svg)
        .replace(/[^\u0009\u000a\u000d\u0020-\ud7ff\ue000-\ufffd\u{10000}-\u{10ffff}]/gu, "")
      image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(serialized)}`
      try {
        await image.decode()
      } catch {
        throw new Error("No se pudo renderizar el contenido de Síntesis para exportarlo como SVG.")
      }
      canvas.width = width * SVG_RENDER_SCALE
      canvas.height = tileHeight * SVG_RENDER_SCALE
      context.fillStyle = "#fffdf8"
      context.fillRect(0, 0, canvas.width, canvas.height)
      context.drawImage(image, 0, 0, canvas.width, canvas.height)
      const raster = canvasSvgImage(canvas)
      if (!raster.startsWith("data:image/jpeg")) throw new Error("No se pudo renderizar el SVG de Síntesis.")
      pages.push({ width, height: tileHeight, image: raster })
    }
    return buildRasterSvg(pages, 0)
  } finally {
    canvas.width = 1
    canvas.height = 1
  }
}

export async function exportSynthesisEditorSvg() {
  const source = document.querySelector<HTMLElement>(".simple-editor-wrapper .tiptap")
  if (!source) throw new Error("No se encontró el editor de Síntesis para exportar.")
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
