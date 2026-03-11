function requireGeminiApiKey() {
  return process.env.GEMINI_API_KEY || process.env.GEMINI_KEY || ""
}

export async function transcribeAudioWithGemini(params: {
  audioBuffer: Buffer
  mimeType: string
}) {
  const apiKey = requireGeminiApiKey()
  if (!apiKey) {
    throw new Error("Missing environment variable: GEMINI_API_KEY")
  }

  const model = process.env.GEMINI_TRANSCRIBE_MODEL || "gemini-2.0-flash"
  const prompt =
    process.env.GEMINI_TRANSCRIBE_PROMPT ||
    "Transcribe el audio en espanol rioplatense y devuelve solo el parrafo limpio, sin introducciones ni etiquetas."

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              { text: prompt },
              {
                inline_data: {
                  mime_type: params.mimeType,
                  data: params.audioBuffer.toString("base64"),
                },
              },
            ],
          },
        ],
      }),
    }
  )

  const payload = await response.json()
  if (!response.ok) {
    throw new Error(payload.error?.message || "Gemini transcription failed")
  }

  const text = payload.candidates?.[0]?.content?.parts?.map((part: { text?: string }) => part.text || "").join("").trim()
  if (!text) {
    throw new Error("Gemini returned an empty transcription")
  }

  return text
}
