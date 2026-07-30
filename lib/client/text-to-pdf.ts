"use client"

type PdfFont = {
  encodeText: (text: string) => unknown
  widthOfTextAtSize: (text: string, size: number) => number
}

type PdfPage = {
  drawText: (
    text: string,
    options: {
      x: number
      y: number
      size: number
      font: PdfFont
      color: unknown
    }
  ) => void
}

type PdfDocument = {
  addPage: (size: [number, number]) => PdfPage
  embedFont: (fontName: string) => Promise<PdfFont>
  save: () => Promise<Uint8Array>
  setTitle: (title: string) => void
  setCreator: (creator: string) => void
  setProducer: (producer: string) => void
}

type PdfLibGlobal = {
  PDFDocument: {
    create: () => Promise<PdfDocument>
  }
  StandardFonts: {
    Courier: string
  }
  rgb: (red: number, green: number, blue: number) => unknown
}

declare global {
  interface Window {
    PDFLib?: PdfLibGlobal
  }
}

const PDF_LIB_SCRIPT_SRC = "/vendor/pdf-lib.min.js"
const A4_WIDTH = 595.28
const A4_HEIGHT = 841.89
const PAGE_MARGIN = 54
const FONT_SIZE = 10
const LINE_HEIGHT = 14

const CHARACTER_REPLACEMENTS: Record<string, string> = {
  "\u00a0": " ",
  "\u2010": "-",
  "\u2011": "-",
  "\u2012": "-",
  "\u2013": "-",
  "\u2014": "-",
  "\u2018": "'",
  "\u2019": "'",
  "\u201a": "'",
  "\u201c": "\"",
  "\u201d": "\"",
  "\u201e": "\"",
  "\u2022": "*",
  "\u2026": "...",
  "\u2190": "<-",
  "\u2192": "->",
  "\ufffd": "?",
}

let pdfLibPromise: Promise<PdfLibGlobal> | null = null

function loadPdfLib() {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("La generación del PDF sólo está disponible en el navegador."))
  }
  if (window.PDFLib) return Promise.resolve(window.PDFLib)
  if (pdfLibPromise) return pdfLibPromise

  pdfLibPromise = new Promise<PdfLibGlobal>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${PDF_LIB_SCRIPT_SRC}"]`)
    const script = existing ?? document.createElement("script")

    const handleLoad = () => {
      if (window.PDFLib) {
        resolve(window.PDFLib)
      } else {
        pdfLibPromise = null
        reject(new Error("No se pudo inicializar el generador de PDF."))
      }
    }
    const handleError = () => {
      pdfLibPromise = null
      reject(new Error("No se pudo cargar el generador de PDF."))
    }

    script.addEventListener("load", handleLoad, { once: true })
    script.addEventListener("error", handleError, { once: true })
    if (!existing) {
      script.src = PDF_LIB_SCRIPT_SRC
      script.async = true
      document.head.appendChild(script)
    }
  })

  return pdfLibPromise
}

export function normalizePdfFileName(value: string) {
  const withoutExtension = value.trim().replace(/\.pdf$/i, "")
  const safeBaseName = withoutExtension
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-")
    .replace(/\s+/g, " ")
    .replace(/[.\s-]+$/g, "")
    .slice(0, 180)
    .trim()

  if (!safeBaseName) throw new Error("Escribe un nombre válido.")
  return `${safeBaseName}.pdf`
}

export function normalizeDraggedText(value: string) {
  return value
    .replace(/\r\n?/g, "\n")
    .replace(/\t/g, "    ")
    .normalize("NFC")
}

export function wrapTextForPdf(value: string, maxCharactersPerLine: number) {
  const maxCharacters = Math.max(1, Math.floor(maxCharactersPerLine))
  return normalizeDraggedText(value)
    .split("\n")
    .flatMap((line) => {
      if (!line.length) return [""]
      const chunks: string[] = []
      for (let index = 0; index < line.length; index += maxCharacters) {
        chunks.push(line.slice(index, index + maxCharacters))
      }
      return chunks
    })
}

function makeTextEncodable(value: string, font: PdfFont) {
  let result = ""

  for (const character of value) {
    const candidate = CHARACTER_REPLACEMENTS[character] ?? character
    for (const replacementCharacter of candidate) {
      if (replacementCharacter === "\n") {
        result += replacementCharacter
        continue
      }
      if (replacementCharacter < " " && replacementCharacter !== "\t") continue
      try {
        font.encodeText(replacementCharacter)
        result += replacementCharacter
      } catch {
        result += "?"
      }
    }
  }

  return result
}

export async function createPdfFileFromText(text: string, requestedName: string) {
  if (!text.trim()) throw new Error("El texto arrastrado está vacío.")

  const fileName = normalizePdfFileName(requestedName)
  const pdfLib = await loadPdfLib()
  const pdfDocument = await pdfLib.PDFDocument.create()
  const font = await pdfDocument.embedFont(pdfLib.StandardFonts.Courier)
  const encodableText = makeTextEncodable(normalizeDraggedText(text), font)
  const availableWidth = A4_WIDTH - PAGE_MARGIN * 2
  const characterWidth = Math.max(1, font.widthOfTextAtSize("M", FONT_SIZE))
  const lines = wrapTextForPdf(encodableText, Math.floor(availableWidth / characterWidth))
  const linesPerPage = Math.max(1, Math.floor((A4_HEIGHT - PAGE_MARGIN * 2) / LINE_HEIGHT))

  pdfDocument.setTitle(fileName.replace(/\.pdf$/i, ""))
  pdfDocument.setCreator("Cursado 2026")
  pdfDocument.setProducer("Cursado 2026")

  for (let offset = 0; offset < lines.length; offset += linesPerPage) {
    const page = pdfDocument.addPage([A4_WIDTH, A4_HEIGHT])
    const pageLines = lines.slice(offset, offset + linesPerPage)
    pageLines.forEach((line, index) => {
      if (!line) return
      page.drawText(line, {
        x: PAGE_MARGIN,
        y: A4_HEIGHT - PAGE_MARGIN - FONT_SIZE - index * LINE_HEIGHT,
        size: FONT_SIZE,
        font,
        color: pdfLib.rgb(0.08, 0.08, 0.08),
      })
    })
  }

  const pdfBytes = await pdfDocument.save()
  return new File([pdfBytes], fileName, { type: "application/pdf" })
}

