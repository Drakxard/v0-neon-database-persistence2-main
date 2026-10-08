import { createHmac, timingSafeEqual } from "node:crypto"
import { getDatalabMarkerApiKey } from "../datalab-marker.ts"

const BASE = "https://www.datalab.to/api/v1/convert"
type Job = { id: string; owner: string; expires: number; words: boolean }
export class DatalabJobError extends Error {
  status: number
  constructor(message: string, status = 502) { super(message); this.status = status }
}
function apiKey() {
  const key = getDatalabMarkerApiKey()
  if (!key) throw new DatalabJobError("Falta configurar datalab en el servidor.", 503)
  return key
}
function sign(value: string) {
  // Unlike the app's local-mode auth default, this secret must not be publicly known.
  return createHmac("sha256", apiKey()).update("subject-pdf-job-v1:" + value).digest()
}
export function signDatalabJob(id: string, owner: string, words: boolean, now = Date.now()) {
  const payload = Buffer.from(JSON.stringify({ id, owner, words, expires: now + 23 * 60 * 60 * 1000 })).toString("base64url")
  return payload + "." + sign(payload).toString("base64url")
}
export function verifyDatalabJob(token: string, owner: string, now = Date.now()): Job {
  try {
    if (token.length > 2048) throw new Error()
    const parts = token.split(".")
    if (parts.length !== 2) throw new Error()
    const signature = Buffer.from(parts[1], "base64url"), expected = sign(parts[0])
    if (signature.length !== expected.length || !timingSafeEqual(signature, expected)) throw new Error()
    const job = JSON.parse(Buffer.from(parts[0], "base64url").toString()) as Job
    if (!/^[\w-]{1,200}$/.test(job.id) || job.owner !== owner || !Number.isFinite(job.expires) || job.expires <= now || typeof job.words !== "boolean") throw new Error()
    return job
  } catch (error) {
    if (error instanceof DatalabJobError) throw error
    throw new DatalabJobError("El seguimiento venció o no es válido. Reintentá la extracción.", 410)
  }
}
async function providerJson(response: Response): Promise<Record<string, unknown>> {
  if (!response.ok) throw new DatalabJobError(`Datalab respondió HTTP ${response.status}.`, response.status === 429 ? 429 : 502)
  const data = await response.json().catch(() => null)
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new DatalabJobError("Datalab devolvió una respuesta inválida.")
  return data
}
export async function submitDatalabFragments(file: File, owner: string, words = false, fetcher: typeof fetch = fetch) {
  const form = new FormData()
  form.set("file", file, file.name)
  form.set("output_format", words ? "json,html" : "json,markdown")
  form.set("mode", "balanced")
  form.set("disable_image_extraction", "true")
  form.set("disable_image_captions", "true")
  if (words) form.set("word_bboxes", "true")
  const data = await providerJson(await fetcher(BASE, { method: "POST", headers: { "X-API-Key": apiKey() }, body: form, signal: AbortSignal.timeout(45_000) }))
  if (data.success !== true || typeof data.request_check_url !== "string") throw new DatalabJobError("Datalab no pudo iniciar la extracción.")
  const url = new URL(data.request_check_url)
  const match = /^\/api\/v1\/convert\/([\w-]{1,200})$/.exec(url.pathname)
  if (url.origin !== "https://www.datalab.to" || !match || url.search || url.hash || url.username || url.password) throw new DatalabJobError("Datalab devolvió un seguimiento inválido.")
  return { token: signDatalabJob(match[1], owner, words) }
}
export async function pollDatalabFragments(token: string, owner: string, fetcher: typeof fetch = fetch) {
  const job = verifyDatalabJob(token, owner)
  let data = await providerJson(await fetcher(`${BASE}/${job.id}`, { headers: { "X-API-Key": apiKey() }, signal: AbortSignal.timeout(45_000), cache: "no-store" }))
  if (data.success === false || data.status === "failed") throw new DatalabJobError("Datalab no pudo completar la extracción.")
  if (data.status !== "complete") return { status: "processing" as const }
  if (typeof data.result_url === "string") {
    const url = new URL(data.result_url)
    // Download URLs are provider-signed, never caller-supplied. Never send the API key here.
    if (url.protocol !== "https:" || url.username || url.password) throw new DatalabJobError("Datalab devolvió una descarga inválida.")
    const downloaded = await providerJson(await fetcher(url, { signal: AbortSignal.timeout(45_000) }))
    data = { ...downloaded, ...Object.fromEntries(Object.entries(data).filter(([, value]) => value != null)) }
  }
  if (data.success === false) throw new DatalabJobError("Datalab no pudo completar la extracción.")
  if (!data.json || typeof data.json !== "object") throw new DatalabJobError("Datalab no devolvió la estructura del documento.")
  return { status: "complete" as const, payload: { json: data.json, markdown: data.markdown ?? "", html: data.html ?? "", metadata: data.metadata ?? {} } }
}
