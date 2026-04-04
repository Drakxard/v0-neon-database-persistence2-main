export function getErrorMessage(payload: unknown, fallback: string) {
  if (payload && typeof payload === "object" && "error" in payload && typeof payload.error === "string") {
    return payload.error
  }

  if (typeof payload === "string" && payload.trim().length > 0) {
    return payload
  }

  return fallback
}

export async function parseJsonResponse(response: Response) {
  const text = await response.text()
  if (!text) return null

  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

export async function readResponsePayload(response: Response) {
  const contentType = response.headers.get("content-type") || ""
  if (contentType.includes("application/json")) {
    return response.json()
  }

  return parseJsonResponse(response)
}

export async function requireOkJson<TPayload = unknown>(response: Response, fallback: string) {
  const payload = await readResponsePayload(response)
  if (!response.ok) {
    throw new Error(getErrorMessage(payload, fallback))
  }

  return payload as TPayload
}
