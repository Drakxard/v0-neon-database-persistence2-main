import { timingSafeEqual } from "node:crypto"

import {
  getDateKeyInTimeZone,
  normalizeInscreenSubjectSegment,
  resolveInscreenRelativeDayDate,
} from "@/lib/inscreen"
import { InscreenHttpError, readInscreenProviderStage } from "@/lib/inscreen-server"
import { downloadR2Object, getR2ObjectMetadata, listR2ObjectsByPrefix } from "@/lib/r2"
import { getSubjectById } from "@/lib/subjects"

export type InscreenProviderKind = "pagina" | "transcripcion"

type ProviderFile = {
  nombre: string
  contenido: string
  actualizadoEn: string | null
  pageNumber?: number
}

function jsonResponse(body: unknown, status = 200, extraHeaders?: HeadersInit) {
  return Response.json(body, {
    status,
    headers: {
      "Cache-Control": "private, no-store, max-age=0",
      ...extraHeaders,
    },
  })
}

export function isValidInscreenProviderAuthorization(header: string | null, expectedToken: string) {
  const match = /^Bearer\s+(.+)$/i.exec(String(header || "").trim())
  const providedToken = match?.[1]?.trim() || ""
  const provided = Buffer.from(providedToken)
  const expected = Buffer.from(expectedToken)
  if (!providedToken || !expectedToken || provided.length !== expected.length) return false
  return timingSafeEqual(provided, expected)
}

function authorizeProvider(request: Request) {
  const expectedToken = String(process.env.INSCREEN_PROVIDER_TOKEN || "").trim()
  if (Buffer.byteLength(expectedToken) < 32) {
    return jsonResponse({ ok: false, error: "provider_not_configured" }, 503)
  }
  if (!isValidInscreenProviderAuthorization(request.headers.get("authorization"), expectedToken)) {
    return jsonResponse(
      { ok: false, error: "unauthorized" },
      401,
      { "WWW-Authenticate": "Bearer" }
    )
  }
  return null
}

export function resolveProviderDayDate(nextTransitionDate: string, day: number) {
  try {
    return resolveInscreenRelativeDayDate(nextTransitionDate, day)
  } catch {
    throw new InscreenHttpError(400, "El dia debe ser un entero entre 0 y 6.")
  }
}

function numericFileOrder(left: { key: string }, right: { key: string }) {
  const id = (key: string) => Number.parseInt(key.split("/").at(-1)?.replace(/\.txt$/i, "") || "", 10)
  const leftId = id(left.key)
  const rightId = id(right.key)
  if (Number.isFinite(leftId) && Number.isFinite(rightId)) return leftId - rightId
  return left.key.localeCompare(right.key)
}

async function loadProviderFile(
  object: { key: string; lastModified: string | null },
  kind: InscreenProviderKind
): Promise<ProviderFile> {
  const [downloaded, metadata] = await Promise.all([
    downloadR2Object(object.key),
    kind === "pagina" ? getR2ObjectMetadata(object.key) : Promise.resolve(null),
  ])
  const pageNumber = Number.parseInt(String(metadata?.metadata?.["page-number"] || ""), 10)
  return {
    nombre: object.key.split("/").at(-1) || object.key,
    contenido: downloaded.buffer.toString("utf8"),
    actualizadoEn: object.lastModified,
    ...(kind === "pagina" && Number.isInteger(pageNumber) && pageNumber > 0 ? { pageNumber } : {}),
  }
}

export async function handleInscreenProviderGet(request: Request, kind: InscreenProviderKind) {
  const unauthorized = authorizeProvider(request)
  if (unauthorized) return unauthorized

  try {
    const url = new URL(request.url)
    const subjectId = String(url.searchParams.get("materia") || "").trim()
    const day = Number.parseInt(String(url.searchParams.get("dia") || ""), 10)
    const subject = getSubjectById(subjectId)
    if (!subject) throw new InscreenHttpError(400, "Materia invalida.")
    if (!Number.isInteger(day) || day < 0 || day > 6) {
      throw new InscreenHttpError(400, "El dia debe ser un entero entre 0 y 6.")
    }

    const currentDate = getDateKeyInTimeZone()
    const accountEmail = String(process.env.INSCREEN_PROVIDER_ACCOUNT_EMAIL || "").trim() || "local@app.local"
    const stage = await readInscreenProviderStage(accountEmail, subjectId, currentDate)
    const requestedDate = resolveProviderDayDate(stage.nextTransitionDate, day)
    const subjectSegment = normalizeInscreenSubjectSegment(subject.name, subject.id)
    const prefix = `InSreen/${subjectSegment}/${stage.currentStage}/${kind}/`
    const objects = (await listR2ObjectsByPrefix(prefix))
      .filter((object) => object.key.endsWith(".txt"))
      .filter((object) => object.lastModified && getDateKeyInTimeZone(new Date(object.lastModified)) === requestedDate)
      .sort(numericFileOrder)
    const archivos = await Promise.all(objects.map((object) => loadProviderFile(object, kind)))

    return jsonResponse({
      ok: true,
      materia: subjectId,
      etapa: stage.currentStage,
      dia: day,
      fecha: requestedDate,
      archivos,
    })
  } catch (error) {
    if (error instanceof InscreenHttpError) {
      return jsonResponse({ ok: false, error: error.message }, error.status)
    }
    console.error(`GET InScreen provider ${kind} error:`, error)
    return jsonResponse({
      ok: false,
      error: error instanceof Error ? error.message : "No se pudieron leer los datos de R2.",
    }, 500)
  }
}
