export type TtsFamily = "melo" | "gemini" | "openai" | "grok" | "inworld" | "aura"
export type TtsModel = {
  id: string
  provider: string
  cloudflareId: string
  family: TtsFamily
  voices: readonly string[]
  defaultVoice?: string
  maxLength: number
}

// Only Cloudflare-exposed voices that can synthesize Spanish. Names are API IDs,
// not languages. Multilingual voices remain available for Spanish text.
// Schemas: https://developers.cloudflare.com/ai/models/{provider}/{model}/
// Spanish/cross-lingual support:
// https://ai.google.dev/gemini-api/docs/speech-generation
// https://docs.x.ai/developers/model-capabilities/audio/text-to-speech
// https://docs.inworld.ai/tts/capabilities/multilingual
const geminiVoices = "Zephyr Puck Charon Kore Fenrir Leda Orus Aoede Callirrhoe Autonoe Enceladus Iapetus Umbriel Algieba Despina Erinome Algenib Rasalgethi Laomedeia Achernar Alnilam Schedar Gacrux Pulcherrima Achird Zubenelgenubi Vindemiatrix Sadachbia Sadaltager Sulafat".split(" ")
const openaiVoices = ["alloy", "echo", "fable", "onyx", "nova", "shimmer"]
const inworldVoices = "Loretta Darlene Marlene Hank Evelyn Celeste Pippa Tessa Liam Callum Hamish Abby Graham Rupert Mortimer Snik Anjali Saanvi Arjun Claire Oliver Simon Elliot James Serena Gareth Vinny Lauren Jessica Ethan Tyler Jason Chloe Veronica Victoria Miranda Sebastian Victor Malcolm Nate Brian Amina Kelsey Derek Evan Kayla Jake Grant Tristan Nadia Selene Marcus Riley Damon Cedric Mia Naomi Jonah Levi Avery Brandon Conrad Bianca Lucian Trevor Alex Ashley Craig Deborah Dennis Edward Elizabeth Hades Julia Pixie Mark Olivia Priya Ronald Sarah Shaun Theodore Timothy Wendy Dominus Hana Clive Carter Blake Luna Reed Duncan Felix Eleanor Sophie".split(" ")

function model(id: string, provider: string, family: TtsFamily, voices: readonly string[], maxLength: number, defaultVoice?: string): TtsModel {
  const author = { melo: "@cf/myshell-ai", gemini: "google", openai: "openai", grok: "xai", inworld: "inworld", aura: "@cf/deepgram" }[family]
  return { id, provider, family, cloudflareId: `${author}/${id}`, voices, maxLength, defaultVoice }
}

export const TTS_MODELS: readonly TtsModel[] = [
  // Melo has no documented upper limit; cap this test UI at 10k characters.
  model("melotts", "MyShell AI", "melo", [], 10_000),
  model("gemini-3.8-flash-lite-tts", "Google", "gemini", geminiVoices, 10_000, "Zephyr"),
  model("gemini-3.8-flash-tts", "Google", "gemini", geminiVoices, 10_000, "Zephyr"),
  model("gemini-3.1-flash-tts", "Google", "gemini", geminiVoices, 10_000, "Zephyr"),
  model("tts-1", "OpenAI", "openai", openaiVoices, 4096, "alloy"),
  model("grok-tts", "xAI", "grok", ["eve", "ara", "rex", "sal", "leo"], 15_000, "eve"),
  model("tts-1.5-mini", "Inworld", "inworld", inworldVoices, 2000, "Dennis"),
  model("tts-2", "Inworld", "inworld", inworldVoices, 2000, "Dennis"),
  model("tts-1-hd", "OpenAI", "openai", openaiVoices, 4096, "alloy"),
  // Conservative local cap for the synchronous test endpoint.
  model("aura-2-es", "Deepgram", "aura", ["sirio", "nestor", "carina", "celeste", "alvaro", "diana", "aquila", "selena", "estrella", "javier"], 2000, "aquila"),
  model("tts-1.5-max", "Inworld", "inworld", inworldVoices, 2000, "Dennis"),
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
  if (voice !== undefined && (typeof voice !== "string" || !model.voices.includes(voice))) {
    throw new TtsInputError("La voz no está disponible en español para este modelo.")
  }
  return { model, voiceId: voice as string | undefined, text }
}

export function ttsInput(model: TtsModel, text: string, voiceId?: string): Record<string, unknown> {
  switch (model.family) {
    case "melo": return { prompt: text, lang: "es" }
    case "aura": return { text, speaker: voiceId, encoding: "mp3" }
    case "gemini": return { text, voice: voiceId }
    case "openai": return { text, voice: voiceId, response_format: "mp3", speed: 1 }
    case "grok": return { text, voice_id: voiceId, language: "es-MX" }
    // Cloudflare's Inworld schema has no language field: it detects Spanish
    // from the unchanged text. Do not forward unsupported provider parameters.
    case "inworld": return { text, voice_id: voiceId, output_format: "mp3", temperature: 1, timestamp_type: "none" }
  }
}
