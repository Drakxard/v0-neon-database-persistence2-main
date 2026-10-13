import { DefaultChatTransport, readUIMessageStream } from "ai"
import { downloadPdfExplanationAttempt, type ExplanationAttempt } from "../pdf-explanation-debug"

export async function requestPdfExplanation(question: string, transcription: string, onProgress: (text: string) => void,
  debug?: ExplanationAttempt, model?: string) {
  if (debug) { debug.stage = "solicitud-gateway"; debug.transcription = transcription; debug.wire = "" }
  const transport = new DefaultChatTransport({
    api: "/api/pdf-explanation",
    fetch: async (url, init) => {
      const response = await fetch(url, init)
      if (debug) { debug.httpStatus = response.status; debug.stage = "respuesta-http" }
      if (!response.ok) {
        const body = await response.text()
        if (debug) debug.responseBody = body.slice(0, 2_000_000)
        let payload: { error?: string; stage?: string } | null = null
        try { payload = JSON.parse(body) } catch { /* Preserve non-JSON proxy errors in the download. */ }
        if (debug && typeof payload?.stage === "string") debug.stage = payload.stage
        throw new Error(payload?.error || `No se pudo generar la explicación (HTTP ${response.status}).`)
      }
      if (debug && response.body) {
        const decoder = new TextDecoder()
        const capture = new TransformStream<Uint8Array, Uint8Array>({
          transform(chunk, controller) {
            debug.wire = (debug.wire + decoder.decode(chunk, { stream: true })).slice(0, 2_000_000)
            controller.enqueue(chunk)
          },
          flush() { debug.wire = (debug.wire + decoder.decode()).slice(0, 2_000_000) },
        })
        return new Response(response.body.pipeThrough(capture), { status: response.status, headers: response.headers })
      }
      return response
    },
  })
  const stream = await transport.sendMessages({
    trigger: "submit-message",
    chatId: crypto.randomUUID(),
    messageId: undefined,
    messages: [{ id: crypto.randomUUID(), role: "user", parts: [{ type: "text", text: question }] }],
    body: { question, transcription, model },
    abortSignal: undefined,
  })
  let html: string | undefined
  let toolError: string | undefined
  if (debug) debug.stage = "lectura-sdk-ui"
  for await (const message of readUIMessageStream({ stream, terminateOnError: true })) {
    if (debug) debug.parts = message.parts
    for (const part of message.parts) {
      if (part.type === "data-explanation-debug") {
        const detail = part.data as { stage?: unknown } | undefined
        if (debug && typeof detail?.stage === "string") debug.stage = detail.stage
        continue
      }
      if (part.type === "data-explanation-status") {
        const status = part.data as { text?: unknown } | undefined
        if (typeof status?.text === "string") onProgress(status.text)
        continue
      }
      if (part.type === "text") onProgress("Generando las pantallas y animaciones…")
      if (part.type === "data-explanation") {
        const output = part.data as { html?: unknown } | undefined
        if (typeof output?.html === "string") html = output.html
        continue
      }
      if (part.type !== "tool-renderExplanation") continue
      if (part.state === "input-streaming") onProgress("Diseñando las pantallas y animaciones…")
      if (part.state === "input-available") onProgress("Preparando la explicación para mostrarla…")
      // A failed tool input can precede the server's recovery response.
      // Wait for that result instead of cancelling the entire stream here.
      if (part.state === "output-error") toolError = part.errorText
      if (part.state === "output-available") {
        const output = part.output as { html?: unknown } | undefined
        if (typeof output?.html === "string") html = output.html
      }
    }
  }
  if (!html) throw new Error(toolError ? `La herramienta no entregó HTML válido: ${toolError}` : "No se recibió la explicación. Volvé a intentarlo.")
  if (debug) { debug.stage = "html-recibido"; debug.html = html }
  return html
}

declare global {
  interface Window {
    requestPdfExplanation: typeof requestPdfExplanation
    downloadPdfExplanationAttempt: typeof downloadPdfExplanationAttempt
  }
}
window.requestPdfExplanation = requestPdfExplanation
window.downloadPdfExplanationAttempt = downloadPdfExplanationAttempt
