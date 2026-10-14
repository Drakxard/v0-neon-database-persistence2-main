export type TtsModel = {
  id: string
  provider: string
  family: "azure" | "gateway"
  voices: readonly string[]
  defaultVoice: string
  maxLength: number
}

// Both voice sets support Spanish; names identify voices, not languages.
// https://learn.microsoft.com/azure/ai-foundry/openai/text-to-speech-quickstart
// https://vercel.com/ai-gateway/models/grok-tts
export const TTS_MODELS: readonly TtsModel[] = [
  { id: "tts-hd", provider: "OpenAI · Microsoft Azure", family: "azure", voices: ["alloy", "echo", "fable", "onyx", "nova", "shimmer"], defaultVoice: "alloy", maxLength: 4096 },
  { id: "spacexai/grok-tts", provider: "xAI · Vercel AI Gateway", family: "gateway", voices: ["eve", "ara", "rex", "sal", "leo"], defaultVoice: "eve", maxLength: 15_000 },
]

export class TtsInputError extends Error {}

export function validateTtsRequest(value: unknown) {
  if (!value || typeof value !== "object") throw new TtsInputError("La solicitud no es válida.")
  const { modelId, voiceId, text } = value as Record<string, unknown>
  const model = TTS_MODELS.find((entry) => entry.id === modelId)
  if (!model) throw new TtsInputError("Elegí un modelo de la lista.")
  if (typeof text !== "string" || !text.trim()) throw new TtsInputError("Escribí un texto en español.")
  if (text.length > model.maxLength) throw new TtsInputError(`Este modelo admite hasta ${model.maxLength} caracteres.`)
  const voice = voiceId === undefined ? model.defaultVoice : voiceId
  if (typeof voice !== "string" || !model.voices.includes(voice)) throw new TtsInputError("La voz no está disponible en español para este modelo.")
  return { model, voiceId: voice, text }
}
