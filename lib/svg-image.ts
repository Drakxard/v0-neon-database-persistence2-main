export type SvgImage = { x: number; y: number; width: number; height: number; src: string }

// Port of escapeXml, svgNumber and exportImage from Secuencial/app.js.
function escapeXml(value: string) {
  return String(value).replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[character]!)
}

export function svgNumber(value: number) { return Math.round(Number(value) * 100) / 100 }

export function exportImage(image: SvgImage) {
  return `<image x="${svgNumber(image.x)}" y="${svgNumber(image.y)}" width="${svgNumber(image.width)}" height="${svgNumber(image.height)}" href="${escapeXml(image.src)}" preserveAspectRatio="none"/>`
}
