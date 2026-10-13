import { createUIMessageStream, createUIMessageStreamResponse, streamText, toUIMessageStream, type LanguageModel } from "ai"
import { explanationHtml, explanationPrompt } from "../pdf-explanation.ts"
import { explanationFailure } from "../pdf-explanation-errors.ts"

export function explanationStream(model: LanguageModel, question: string, transcription: string,
  options: { fallbackModels?: string[]; maxOutputTokens?: number; reasoning?: "none" | "low"; provider?: "azure" | "gateway" } = {}) {
  let failureDiagnostics: ReturnType<typeof explanationFailure>["diagnostics"] | undefined
  const reportError = (error: unknown) => {
    const failure = explanationFailure(error, options.provider)
    failureDiagnostics = failure.diagnostics
    console.error("[PDF explicación]", options.provider ?? "gateway", failure.diagnostics)
    return failure.message
  }
  // The only prompt content is the user's request and this page's text.
  const result = streamText({
    model,
    prompt: explanationPrompt(question, transcription),
    reasoning: options.reasoning ?? "none",
    maxOutputTokens: options.provider === "azure" ? (options.maxOutputTokens ?? 12_000) : Math.min(options.maxOutputTokens ?? 1_800, 1_800),
    ...(options.provider === "azure"
      ? { providerOptions: { openai: { forceReasoning: true, reasoningEffort: "low", reasoningSummary: null } } }
      : options.fallbackModels?.length ? { providerOptions: { gateway: { models: options.fallbackModels } } } : {}),
    maxRetries: 0,
    onError: ({ error }) => { reportError(error) },
  })
  return createUIMessageStreamResponse({
    stream: createUIMessageStream({
      execute: async ({ writer }) => {
        const diagnostic = (stage: string, details: Record<string, unknown> = {}) => writer.write({
          type: "data-explanation-debug", data: { version: "verlo-debug-v1", stage, ...details },
        })
        diagnostic("modelo-principal", { model: typeof model === "object" ? model.modelId : model })
        let failed = false
        const reader = toUIMessageStream({ stream: result.stream, sendReasoning: false, sendSources: false, onError: reportError }).getReader()
        try {
          while (true) {
            const { done, value } = await reader.read()
            if (done) break
            if (value.type === "finish") { diagnostic("modelo-principal-finalizado", { finishReason: value.finishReason }); continue }
            if (value.type === "abort") {
              failed = true
              diagnostic("solicitud-interrumpida")
              writer.write({ type: "error", errorText: "La generación se interrumpió. Presioná Enter para reintentar." })
              continue
            }
            if (value.type === "error") { failed = true; diagnostic("error-gateway", { error: value.errorText, diagnostics: failureDiagnostics }) }
            writer.write(value)
          }
        } finally { reader.releaseLock() }
        if (failed) return
        const text = await result.text
        const reason = await result.finishReason
        diagnostic("validacion-html", { text, finishReason: reason, usage: await result.totalUsage })
        const document = text.match(/(?:<!doctype html[^>]*>\s*)?<html\b[\s\S]*?<\/html>/i)?.[0]
        if (!document) {
          writer.write({ type: "error", errorText: reason === "length"
            ? "El modelo agotó su límite antes de completar el HTML. La respuesta recibida está en el archivo descargado."
            : "El modelo respondió sin entregar HTML completo. Revisá el archivo descargado y ajustá tu solicitud." })
          return
        }
        writer.write({ type: "data-explanation", data: { html: explanationHtml(document) } })
        diagnostic("html-validado")
        writer.write({ type: "finish" })
      },
      onError: reportError,
    }),
    headers: { "Cache-Control": "no-store" },
    keepAliveMs: 10_000,
  })
}
