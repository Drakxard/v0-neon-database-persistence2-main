const SVG_NAMESPACE = "http://www.w3.org/2000/svg"

// dom-to-svg emits multiline tspans with textLength/spacingAndGlyphs. That
// scales the glyphs themselves and depends on the importer's font metrics.
// Emit independent text lines with explicit presentation attributes instead.
export function normalizeSvgText(svg: Element, measuredSvg: SVGSVGElement) {
  const measuredTexts = measuredSvg.querySelectorAll<SVGTextElement>("text")
  svg.querySelectorAll("text").forEach((text, index) => {
    const measured = measuredTexts[index]
    const before = measured.getBBox().y
    measured.removeAttribute("dominant-baseline")
    const baselineOffset = before - measured.getBBox().y
    const lines = text.children.length ? Array.from(text.querySelectorAll("tspan")) : [text]
    const group = text.ownerDocument.createElementNS(SVG_NAMESPACE, "g")
    // Keep group effects once, instead of duplicating them on every line.
    for (const name of ["id", "transform", "opacity", "mask", "clip-path"]) {
      if (text.hasAttribute(name)) group.setAttribute(name, text.getAttribute(name)!)
    }
    for (const line of lines) {
      const output = text.ownerDocument.createElementNS(SVG_NAMESPACE, "text")
      for (const attributes of [text.attributes, line.attributes]) {
        for (const attribute of Array.from(attributes)) {
          if (["id", "transform", "opacity", "mask", "clip-path", "dominant-baseline", "textLength", "lengthAdjust"].includes(attribute.name)) continue
          if (attribute.name.startsWith("xml:")) output.setAttributeNS("http://www.w3.org/XML/1998/namespace", attribute.name, attribute.value)
          else if (attribute.namespaceURI) output.setAttributeNS(attribute.namespaceURI, attribute.name, attribute.value)
          else output.setAttribute(attribute.name, attribute.value)
        }
      }
      if (output.hasAttribute("y")) output.setAttribute("y", String(Number(output.getAttribute("y")) + baselineOffset))
      // SVG text does not wrap; each line keeps its measured starting point.
      output.textContent = line.textContent
      group.append(output)
    }
    text.replaceWith(group)
  })
}
