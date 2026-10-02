const apiKey = process.env.gatewayia?.trim()
if (!apiKey) {
  console.error("Falta gatewayia en el entorno. Configurá la clave del mismo equipo de Vercel antes de ejecutar esta prueba.")
  process.exit(2)
}

const endpoint = "https://ai-gateway.vercel.sh/v1/evaluate"
const request = {
  model: "typesafe-ai/jev",
  state: "The support agent issued a full refund to the customer.",
  questions: {
    refunded: { type: "boolean", instructions: "Was a refund issued?" },
  },
}

async function probe(label, providerOptions) {
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ ...request, ...(providerOptions ? { providerOptions } : {}) }),
      signal: AbortSignal.timeout(25_000),
      cache: "no-store",
    })
    const body = await response.text()
    let parsed
    try { parsed = JSON.parse(body) } catch { parsed = null }
    const gateway = parsed?.providerMetadata?.gateway
    const failure = parsed?.error
    const result = {
      probe: label,
      status: response.status,
      requestId: response.headers.get("x-vercel-id") ?? response.headers.get("x-request-id"),
      generationId: gateway?.generationId ?? null,
      provider: gateway?.routing?.finalProvider ?? null,
      ...(response.ok
        ? { answers: parsed?.answers ?? null }
        : {
            code: failure?.code ?? failure?.type ?? parsed?.type ?? null,
            response: body.replaceAll(apiKey, "[redacted]").slice(0, 2_000),
          }),
    }
    console.log(JSON.stringify(result, null, 2))
    return response.status
  } catch (error) {
    console.error(JSON.stringify({ probe: label, networkError: error instanceof Error ? error.message : String(error) }))
    return 0
  }
}

const defaultStatus = await probe("default")
if (defaultStatus === 403) {
  const typeSafeStatus = await probe("typesafe-ai", { gateway: { only: ["typesafe-ai"] } })
  if (typeSafeStatus === 200) {
    console.log("Jev funciona con TypeSafe AI; considerá preferir ese proveedor con gateway.order sin bloquear los demás.")
  }
  process.exitCode = typeSafeStatus === 200 ? 0 : 1
} else {
  process.exitCode = defaultStatus === 200 ? 0 : 1
}
