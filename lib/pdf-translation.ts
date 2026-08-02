export const PDF_TRANSLATION_MODEL = "llama-3.3-70b-versatile"
export const DEFAULT_PDF_TRANSLATION_PROMPT = "Traduce a español el texto, sin agregar de más: {texto}"
export const PDF_TRANSLATION_TEXT_TOKEN = "{texto}"

export function buildPdfTranslationPrompt(text: string, promptTemplate: string) {
  const normalizedText = String(text || "").trim()
  const normalizedTemplate = String(promptTemplate || "").trim()
  if (!normalizedText) throw new Error("TRANSLATION_TEXT_REQUIRED")
  if (!normalizedTemplate.includes(PDF_TRANSLATION_TEXT_TOKEN)) {
    throw new Error("TRANSLATION_TOKEN_REQUIRED")
  }
  return normalizedTemplate.split(PDF_TRANSLATION_TEXT_TOKEN).join(normalizedText)
}
