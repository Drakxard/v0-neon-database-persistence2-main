import { SYNTHESIS_MAX_IMAGE_BYTES } from "./synthesis-workspace.ts"

export class InvalidSynthesisImageError extends Error {}

// R2 objects from earlier uploads may have missing or incorrect Content-Type.
// Android accepts only these raster formats, even when a browser can sniff more.
export function synthesisImageMimeType(bytes: Uint8Array): string {
  if (!bytes.length || bytes.length > SYNTHESIS_MAX_IMAGE_BYTES) throw new InvalidSynthesisImageError("Tamaño de imagen inválido.")
  const ascii = (start: number, length: number) => String.fromCharCode(...bytes.subarray(start, start + length))
  if ([137, 80, 78, 71, 13, 10, 26, 10].every((byte, index) => bytes[index] === byte)) return "image/png"
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return "image/jpeg"
  if (["GIF87a", "GIF89a"].includes(ascii(0, 6))) return "image/gif"
  if (ascii(0, 4) === "RIFF" && ascii(8, 4) === "WEBP") return "image/webp"
  throw new InvalidSynthesisImageError("Formato de imagen no compatible.")
}
