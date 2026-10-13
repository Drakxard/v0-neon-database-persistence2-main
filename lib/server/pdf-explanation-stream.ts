import { createUIMessageStream, createUIMessageStreamResponse, jsonSchema, streamText, tool, toUIMessageStream, type LanguageModel } from "ai"
import { explanationHtml, explanationPrompt } from "../pdf-explanation.ts"
import { explanationFailure } from "../pdf-explanation-errors.ts"

export function explanationStream(model: LanguageModel, question: string, transcription: string,
  options: { fallbackModels?: string[]; recoveryModel?: LanguageModel; maxOutputTokens?: number } = {}) {
  const abortSignal = AbortSignal.timeout(60_000)
  const reportError = (error: unknown) => {
    const failure = explanationFailure(error)
    console.error("[PDF explicación] AI Gateway", failure.diagnostics)
    return failure.message
  }
  const result = streamText({
    model,
    prompt: explanationPrompt(question, transcription),
    tools: {
      renderExplanation: tool({
        description: "Entrega la interfaz didáctica animada para mostrarla encima del PDF mediante Vercel AI SDK UI. El HTML debe responder a la duda usando la transcripción proporcionada y funcionar sin conexión.",
        inputSchema: jsonSchema<{ html: string }>({
          type: "object",
          properties: { html: { type: "string", minLength: 1, maxLength: 1_500_000, description: "Documento HTML completo con pantallas, controles y animaciones didácticas." } },
          required: ["html"],
          additionalProperties: false,
        }),
        execute: async ({ html }) => ({ html: explanationHtml(html) }),
      }),
    },
    // Free models can return the document as text; a forced tool would make
    // AI SDK reject that otherwise usable response before it reaches the UI.
    toolChoice: "auto",
    reasoning: "none",
    maxOutputTokens: Math.min(options.maxOutputTokens ?? 6_000, 6_000),
    ...(options.fallbackModels?.length ? { providerOptions: { gateway: { models: options.fallbackModels } } } : {}),
    maxRetries: 0,
    abortSignal,
    onError: ({ error }) => { reportError(error) },
  })
  return createUIMessageStreamResponse({
    stream: createUIMessageStream({
      execute: async ({ writer }) => {
        let delivered = false
        let failed = false
        let toolError: string | undefined
        const reader = toUIMessageStream({
          stream: result.stream,
          sendReasoning: false,
          sendSources: false,
          onError: reportError,
        }).getReader()
        try {
          while (true) {
            const { done, value } = await reader.read()
            if (done) break
            // Finish only after checking that a usable interface was delivered.
            if (value.type === "finish") continue
            if (value.type === "tool-output-error") {
              toolError = value.errorText
              continue
            }
            if (value.type === "tool-output-available") delivered = true
            if (value.type === "abort") {
              failed = true
              writer.write({ type: "error", errorText: reportError({ name: "TimeoutError" }) })
              continue
            }
            if (value.type === "error") failed = true
            writer.write(value)
          }
        } finally {
          reader.releaseLock()
        }
        if (failed) return
        if (!delivered) {
          // Some free models return HTML as text instead of calling the tool.
          // Keep the same SDK UI transport and validate before exposing it.
          let text = await result.text
          let reason = await result.finishReason
          const extract = (text: string) => text.match(/(?:<!doctype html[^>]*>\s*)?<html\b[\s\S]*?<\/html>/i)?.[0]
          let document = extract(text)
          if (!document && options.recoveryModel && !abortSignal.aborted) {
            writer.write({ type: "data-explanation-status", data: { text: "El primer modelo no entregó HTML; probando otro modelo gratuito…" } })
            const recovery = streamText({
              model: options.recoveryModel,
              prompt: explanationPrompt(question, transcription, "text"),
              reasoning: "none",
              maxOutputTokens: Math.min(options.maxOutputTokens ?? 6_000, 6_000),
              maxRetries: 0,
              abortSignal,
              onError: ({ error }) => { reportError(error) },
            })
            const recoveryReader = toUIMessageStream({ stream: recovery.stream, sendReasoning: false, sendSources: false,
              onError: reportError }).getReader()
            try {
              while (true) {
                const { done, value } = await recoveryReader.read()
                if (done) break
                if (value.type === "start" || value.type === "finish") continue
                if (value.type === "abort") {
                  failed = true
                  writer.write({ type: "error", errorText: reportError({ name: "TimeoutError" }) })
                  continue
                }
                if (value.type === "error") failed = true
                writer.write(value)
              }
            } finally { recoveryReader.releaseLock() }
            if (failed) return
            text = await recovery.text
            reason = await recovery.finishReason
            document = extract(text)
          }
          if (document) {
            writer.write({ type: "data-explanation", data: { html: explanationHtml(document) } })
          } else {
            console.error("[PDF explicación] Sin HTML", { finishReason: reason, textLength: text.length, toolError: Boolean(toolError) })
            writer.write({ type: "error", errorText: reason === "length"
              ? "El modelo agotó su límite antes de completar el HTML. Presioná Enter para reintentar; la página ya está transcrita."
              : "El modelo gratuito terminó sin entregar HTML completo. Presioná Enter para reintentar; la página ya está transcrita." })
            return
          }
        }
        writer.write({ type: "finish" })
      },
      onError: reportError,
    }),
    headers: { "Cache-Control": "no-store" },
  })
}
