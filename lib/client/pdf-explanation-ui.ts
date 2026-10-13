import { DefaultChatTransport, readUIMessageStream } from "ai"

export async function requestPdfExplanation(question: string, transcription: string, onProgress: (text: string) => void) {
  const transport = new DefaultChatTransport({
    api: "/api/pdf-explanation",
    fetch: async (url, init) => {
      const response = await fetch(url, init)
      if (!response.ok) {
        const payload = await response.json().catch(() => null) as { error?: string } | null
        throw new Error(payload?.error || `No se pudo generar la explicación (HTTP ${response.status}).`)
      }
      return response
    },
  })
  const stream = await transport.sendMessages({
    trigger: "submit-message",
    chatId: crypto.randomUUID(),
    messageId: undefined,
    messages: [{ id: crypto.randomUUID(), role: "user", parts: [{ type: "text", text: question }] }],
    body: { question, transcription },
    abortSignal: AbortSignal.timeout(120_000),
  })
  let html: string | undefined
  for await (const message of readUIMessageStream({ stream, terminateOnError: true })) {
    for (const part of message.parts) {
      if (part.type !== "tool-renderExplanation") continue
      if (part.state === "input-streaming") onProgress("Diseñando las pantallas y animaciones…")
      if (part.state === "input-available") onProgress("Preparando la explicación para mostrarla…")
      if (part.state === "output-error") throw new Error("El modelo no entregó una explicación HTML válida. Volvé a intentarlo.")
      if (part.state === "output-available") {
        const output = part.output as { html?: unknown } | undefined
        if (typeof output?.html === "string") html = output.html
      }
    }
  }
  if (!html) throw new Error("No se recibió la explicación. Volvé a intentarlo.")
  return html
}

declare global {
  interface Window {
    requestPdfExplanation: typeof requestPdfExplanation
  }
}
window.requestPdfExplanation = requestPdfExplanation
