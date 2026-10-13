export function explanationFailure(error: unknown, provider: "gateway" | "azure" = "gateway") {
  let current = error as { name?: string; statusCode?: number; generationId?: string; cause?: unknown; lastError?: unknown } | null
  let status: number | undefined, name: string | undefined, generationId: string | undefined
  for (let depth = 0; current && depth < 6; depth++) {
    status = current.statusCode || status
    name = current.name || name
    generationId = current.generationId || generationId
    current = (current.lastError || current.cause) as typeof current
  }
  const message = status === 401 ? "AI Gateway rechazó la clave gatewayia (401). Revisá la credencial del servidor."
    : status === 402 ? "AI Gateway no tiene saldo disponible (402). Revisá los créditos de la cuenta de Vercel."
    : status === 403 ? "AI Gateway rechazó el acceso a los modelos gratuitos (403). Revisá la disponibilidad del Free Tier y los permisos de la cuenta de Vercel."
    : status === 404 ? "AI Gateway no encontró el modelo (404). Revisá PDF_EXPLANATION_MODEL en el servidor."
    : status === 429 ? "AI Gateway alcanzó el límite de solicitudes (429). Esperá un momento y presioná Enter para reintentar."
    : status === 408 || status === 504 || name === "TimeoutError" || name === "AbortError" ? "AI Gateway tardó demasiado. Presioná Enter para reintentar; la transcripción ya está guardada."
    : status === 400 ? "AI Gateway rechazó la solicitud (400). Revisá que PDF_EXPLANATION_MODEL admita herramientas."
    : "No se pudo generar la explicación con AI Gateway. Presioná Enter para reintentar."
  const azureMessage = status === 401 ? "Azure rechazó la clave gpt5mini (401). Revisá la API key del recurso."
    : status === 403 ? "Azure rechazó el acceso (403). Revisá los permisos de la suscripción y del recurso."
    : status === 404 ? "Azure no encontró el despliegue (404). Revisá conexiongpt5mini y AZURE_OPENAI_DEPLOYMENT."
    : status === 429 ? "Azure alcanzó la cuota disponible (429). Esperá un momento y presioná Enter para reintentar."
    : status === 400 ? "Azure rechazó la solicitud (400). Revisá el modelo y las opciones del despliegue."
    : "No se pudo generar la explicación con Azure. Presioná Enter para reintentar; la transcripción ya está guardada."
  return { message: provider === "azure" ? azureMessage : message, diagnostics: { status, name, generationId } }
}
