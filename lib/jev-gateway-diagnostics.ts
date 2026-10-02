export function summarizeGatewayFailure(response: Response, body: string, credentials: readonly string[]) {
  let code: string | null = null
  try {
    const parsed: unknown = JSON.parse(body)
    if (parsed && typeof parsed === "object") {
      const record = parsed as Record<string, unknown>
      const error = record.error && typeof record.error === "object"
        ? record.error as Record<string, unknown> : record
      const value = error.code ?? error.type
      if (typeof value === "string") code = value
    }
  } catch {
    // Gateway can return an empty or non-JSON error body.
  }

  const sanitized = credentials.filter(Boolean).reduce(
    (text, credential) => text.replaceAll(credential, "[redacted]"), body,
  )
  return {
    status: response.status,
    code,
    requestId: response.headers.get("x-vercel-id") ?? response.headers.get("x-request-id"),
    response: sanitized.slice(0, 2_000),
  }
}
