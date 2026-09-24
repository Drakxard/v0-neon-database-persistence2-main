import { exportImage, svgNumber, type SvgImage } from "../svg-image"
import { normalizeSvgText } from "./svg-text"

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

function listNumber(value: number, type: string): string {
  if (/alpha|latin/.test(type) && value > 0) {
    let letters = ""
    for (let n = value; n > 0; n = Math.floor((n - 1) / 26)) letters = String.fromCharCode(97 + (n - 1) % 26) + letters
    return type.startsWith("upper") ? letters.toUpperCase() : letters
  }
  if (/roman/.test(type) && value > 0 && value < 4000) {
    let result = "", n = value
    for (const [amount, symbol] of [[1000, "M"], [900, "CM"], [500, "D"], [400, "CD"], [100, "C"], [90, "XC"], [50, "L"], [40, "XL"], [10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"]] as const) {
      while (n >= amount) { result += symbol; n -= amount }
    }
    return type.startsWith("upper") ? result : result.toLowerCase()
  }
  return type === "decimal-leading-zero" ? String(value).padStart(2, "0") : String(value)
}

// dom-to-svg renders backgrounds/borders and browser-measured text runs as SVG
// primitives. Its missing ::marker support is supplied on the detached copy.
function materializeListMarkers(root: HTMLElement) {
  for (const list of root.querySelectorAll("ol, ul")) {
    const items = Array.from(list.children).filter((child): child is HTMLLIElement => child instanceof HTMLLIElement)
    const reversed = list.hasAttribute("reversed")
    let number = Number(list.getAttribute("start") ?? (reversed ? items.length : 1))
    for (const item of items) {
      if (item.hasAttribute("value")) number = Number(item.getAttribute("value"))
      const style = getComputedStyle(item)
      const type = style.listStyleType
      if (style.display === "list-item" && type !== "none") {
        const marker = document.createElement("span")
        marker.textContent = ({ disc: "•", circle: "◦", square: "▪" } as Record<string, string>)[type] ?? `${listNumber(number, type)}.`
        marker.setAttribute("data-export-marker", "")
        marker.style.cssText = "position:absolute;right:100%;top:0;white-space:pre;padding-right:.4em;"
        marker.style.font = style.font
        item.style.position = "relative"
        item.style.listStyleType = "none"
        item.prepend(marker)
      }
      number += reversed ? -1 : 1
    }
  }
}

// HTML/foreignObject works in browsers but is not a portable Figma import.
// Keep layout measurement isolated from the live ProseMirror document.
export async function buildSynthesisEditorSvg(source: HTMLElement): Promise<string> {
  const { elementToSVG } = await import("dom-to-svg")
  await document.fonts.ready
  await Promise.all(Array.from(source.querySelectorAll("img"), (image) => image.decode()))

  // Images follow Secuencial's exportImage path directly. Do not feed them
  // through the DOM converter's stacking groups, masks or xlink serialization.
  const sourceBounds = source.getBoundingClientRect()
  const imageSources = new Map<string, Promise<string>>()
  const exportedImages: SvgImage[] = []
  for (const image of source.querySelectorAll("img")) {
    if (image.closest(EDITOR_CONTROLS)) continue
    const bounds = image.getBoundingClientRect()
    if (bounds.width <= 0 || bounds.height <= 0) continue
    const src = image.currentSrc || image.src
    if (!imageSources.has(src)) imageSources.set(src, imageDataUrl(src))
    exportedImages.push({
      x: bounds.left - sourceBounds.left, y: bounds.top - sourceBounds.top,
      width: bounds.width, height: bounds.height, src,
    })
  }
  await Promise.all(exportedImages.map(async (image) => { image.src = await imageSources.get(image.src)! }))

  const clone = source.cloneNode(true) as HTMLElement
  const originals = [source, ...Array.from(source.querySelectorAll<HTMLElement>("*"))]
  const copies = [clone, ...Array.from(clone.querySelectorAll<HTMLElement>("*"))]
  const pseudoRules: string[] = []

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
    if (original.matches('li[data-checked="true"] > label > span')) {
      // Tiptap draws its check with a CSS mask, which SVG importers cannot use.
      const namespace = "http://www.w3.org/2000/svg"
      const check = document.createElementNS(namespace, "svg")
      check.setAttribute("viewBox", "0 0 24 24")
      check.style.cssText = "position:absolute;left:.125em;top:.125em;width:.75em;height:.75em;"
      const path = document.createElementNS(namespace, "path")
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
      copy.setAttribute("src", original.currentSrc || original.src)
      copy.removeAttribute("srcset")
      copy.removeAttribute("sizes")
      copy.removeAttribute("loading")
    }
    if (original.classList.contains("tableWrapper")) {
      copy.style.overflow = "visible"
    }
  })
  const width = Math.max(1, Math.ceil(source.scrollWidth), source.offsetWidth, ...exportedImages.map((image) => Math.ceil(image.x + image.width)))
  const height = Math.max(1, Math.ceil(source.scrollHeight), source.offsetHeight, ...exportedImages.map((image) => Math.ceil(image.y + image.height)))
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
  const mount = document.createElement("div")
  mount.style.cssText = "position:fixed;left:0;top:0;opacity:0;pointer-events:none;z-index:-2147483647;"
  mount.setAttribute("aria-hidden", "true")
  mount.append(clone)
  document.body.append(mount)
  const selection = window.getSelection()
  const savedSelection = selection?.anchorNode && selection.focusNode ? {
    anchor: selection.anchorNode, anchorOffset: selection.anchorOffset,
    focus: selection.focusNode, focusOffset: selection.focusOffset,
  } : null
  let svgDocument: XMLDocument
  try {
    await Promise.all(Array.from(clone.querySelectorAll("img"), (image) => image.decode()))
    materializeListMarkers(clone)
    const bounds = clone.getBoundingClientRect()
    svgDocument = elementToSVG(clone, { captureArea: new DOMRect(bounds.x, bounds.y, width, height), keepLinks: false })
    const svg = svgDocument.documentElement
    // All document images are emitted separately by Secuencial's serializer.
    svg.querySelectorAll("image").forEach((image) => image.remove())
    // Figma does not use embedded web fonts. Native text retains the font name;
    // avoid copying every unrelated font stylesheet into this export.
    svg.querySelectorAll("style").forEach((style) => style.remove())
    // Resolve dominant-baseline in the browser, then bake it into plain y
    // coordinates, so importers need not implement CSS baseline alignment.
    const measurable = document.importNode(svg, true) as unknown as SVGSVGElement
    mount.append(measurable)
    normalizeSvgText(svg, measurable)
  } finally {
    mount.remove()
    if (savedSelection) selection?.setBaseAndExtent(savedSelection.anchor, savedSelection.anchorOffset, savedSelection.focus, savedSelection.focusOffset)
    else selection?.removeAllRanges()
  }

  for (const element of svgDocument.querySelectorAll("*")) {
    for (const attribute of Array.from(element.attributes)) {
      if (/^(data-|aria-)/.test(attribute.name) || attribute.name === "class") element.removeAttribute(attribute.name)
    }
  }
  if (svgDocument.querySelector("foreignObject")) throw new Error("La exportación contiene contenido no compatible con Figma.")
  const serializer = new XMLSerializer()
  const vectorMarkup = Array.from(svgDocument.documentElement.children, (element) => serializer.serializeToString(element)).join("")
  const imageMarkup = exportedImages.map(exportImage).join("")
  // Same outer SVG and native image markup as Secuencial. Images are direct
  // children, independent of every mask/opacity group generated for rich text.
  return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${svgNumber(width)}" height="${svgNumber(height)}" viewBox="0 0 ${svgNumber(width)} ${svgNumber(height)}" data-exporter="sintesis-secuencial-v1">${vectorMarkup}${imageMarkup}</svg>`
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
