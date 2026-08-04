const DATALAB_CONVERT_URL = "https://www.datalab.to/api/v1/convert"
const POLL_INTERVAL_MS = 1_000
const MAX_POLL_ATTEMPTS = 45

type DatalabResponse = {
  success?: boolean
  error?: string | null
  request_check_url?: string
  status?: string
  markdown?: string | null
}

type FetchLike = typeof fetch

export class DatalabMarkerError extends Error {}

export function getDatalabMarkerApiKey(env: NodeJS.ProcessEnv = process.env) {
  return String(env.MARKER_API || env.marker_api || "").trim()
}

function asResponse(value: unknown): DatalabResponse {
  return value && typeof value === "object" ? value as DatalabResponse : {}
}

async function readJson(response: Response) {
  return asResponse(await response.json().catch(() => null))
}

function sleep(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds))
}

export async function convertPdfPageWithDatalabMarker(params: {
  file: File
  apiKey?: string
  fetchImpl?: FetchLike
  wait?: (milliseconds: number) => Promise<void>
  maxPollAttempts?: number
}) {
  const apiKey = String(params.apiKey ?? getDatalabMarkerApiKey()).trim()
  if (!apiKey) throw new DatalabMarkerError("MARKER_API no esta configurada.")

  const form = new FormData()
  form.append("file", params.file, params.file.name || "pagina.pdf")
  form.append("output_format", "markdown")
  form.append("mode", "fast")
  form.append("disable_image_extraction", "true")
  form.append("disable_image_captions", "true")

  const fetchImpl = params.fetchImpl ?? fetch
  const submitted = await fetchImpl(DATALAB_CONVERT_URL, {
    method: "POST",
    headers: { "X-API-Key": apiKey },
    body: form,
  })
  const submission = await readJson(submitted)
  if (!submitted.ok || !submission.success || !submission.request_check_url) {
    throw new DatalabMarkerError(submission.error || "Datalab no pudo iniciar la conversion.")
  }

  const checkUrl = new URL(submission.request_check_url)
  if (
    checkUrl.protocol !== "https:" ||
    (checkUrl.hostname !== "datalab.to" && !checkUrl.hostname.endsWith(".datalab.to"))
  ) {
    throw new DatalabMarkerError("Datalab devolvio una URL de seguimiento invalida.")
  }

  const wait = params.wait ?? sleep
  const maxPollAttempts = params.maxPollAttempts ?? MAX_POLL_ATTEMPTS
  for (let attempt = 0; attempt < maxPollAttempts; attempt += 1) {
    await wait(POLL_INTERVAL_MS)
    const checked = await fetchImpl(checkUrl, { headers: { "X-API-Key": apiKey } })
    const result = await readJson(checked)
    if (!checked.ok) throw new DatalabMarkerError(result.error || "No se pudo consultar la conversion en Datalab.")
    if (result.status === "failed" || result.success === false) {
      throw new DatalabMarkerError(result.error || "Datalab no pudo convertir la pagina.")
    }
    if (result.status === "complete") {
      const markdown = String(result.markdown || "").trim()
      if (!markdown) throw new DatalabMarkerError("Datalab no devolvio texto para la pagina.")
      return markdown
    }
  }

  throw new DatalabMarkerError("Datalab tardo demasiado en convertir la pagina.")
}
