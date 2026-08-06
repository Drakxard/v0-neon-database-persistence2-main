import { timingSafeEqual } from "node:crypto"

import {
  getDateKeyInTimeZone,
  normalizeInscreenSubjectSegment,
  resolveInscreenRelativeDayDate,
} from "@/lib/inscreen"
import {
  InscreenHttpError,
  listInscreenProviderStages,
  type InscreenStageManifest,
} from "@/lib/inscreen-server"
import { downloadR2Object, getR2ObjectMetadata, listR2ObjectsByPrefix } from "@/lib/r2"

export type InscreenProviderKind = "pagina" | "transcripcion"

type ProviderFile = {
  nombre: string
  contenido: string
}

function providerErrorResponse(error: string, status: number, extraHeaders?: HeadersInit) {
  return jsonResponse({ ok: false, archivos: [], error }, status, extraHeaders)
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
    return providerErrorResponse("Proveedor InScreen no configurado.", 503)
  }
  if (!isValidInscreenProviderAuthorization(request.headers.get("authorization"), expectedToken)) {
    return providerErrorResponse(
      "No autorizado.",
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

async function loadProviderFile(object: { key: string }): Promise<ProviderFile> {
  const downloaded = await downloadR2Object(object.key)
  return {
    nombre: object.key.split("/").at(-1) || object.key,
    contenido: downloaded.buffer.toString("utf8"),
  }
}

async function findSubjectIdFromFolder(subjectSegment: string) {
  const objects = (await listR2ObjectsByPrefix(`InSreen/${subjectSegment}/`))
    .filter((object) => object.key.endsWith(".txt"))
    .sort((left, right) => String(right.lastModified || "").localeCompare(String(left.lastModified || "")))
  for (const object of objects) {
    const metadata = await getR2ObjectMetadata(object.key)
    const subjectId = String(metadata.metadata["subject-id"] || "").trim()
    if (subjectId) return subjectId
  }
  return ""
}

async function resolveProviderStage(
  accountEmail: string,
  subjectSegment: string,
  currentDate: string
): Promise<InscreenStageManifest> {
  const stages = await listInscreenProviderStages(accountEmail, currentDate)
  const direct = stages.filter(
    (stage) => normalizeInscreenSubjectSegment(stage.subjectId) === subjectSegment
  )
  if (direct.length === 1) return direct[0]

  const metadataSubjectId = await findSubjectIdFromFolder(subjectSegment)
  const resolved = stages.find((stage) => stage.subjectId === metadataSubjectId)
  if (resolved) return resolved
  throw new InscreenHttpError(404, "No existe una etapa para la materia solicitada.")
}

export async function handleInscreenProviderGet(request: Request, kind: InscreenProviderKind) {
  const unauthorized = authorizeProvider(request)
  if (unauthorized) return unauthorized

  try {
    const url = new URL(request.url)
    const subjectSegment = String(url.searchParams.get("materia") || "").trim()
    const day = Number.parseInt(String(url.searchParams.get("dia") || ""), 10)
    if (!/^[a-z0-9]{1,300}$/.test(subjectSegment)) {
      throw new InscreenHttpError(400, "Materia invalida.")
    }
    if (!Number.isInteger(day) || day < 0 || day > 6) {
      throw new InscreenHttpError(400, "El dia debe ser un entero entre 0 y 6.")
    }

    const currentDate = getDateKeyInTimeZone()
    const accountEmail = String(process.env.INSCREEN_PROVIDER_ACCOUNT_EMAIL || "").trim() || "local@app.local"
    const stage = await resolveProviderStage(accountEmail, subjectSegment, currentDate)
    const requestedDate = resolveProviderDayDate(stage.nextTransitionDate, day)
    const prefix = `InSreen/${subjectSegment}/${stage.currentStage}/${kind}/`
    const objects = (await listR2ObjectsByPrefix(prefix))
      .filter((object) => object.key.endsWith(".txt"))
      .filter((object) => object.lastModified && getDateKeyInTimeZone(new Date(object.lastModified)) === requestedDate)
      .sort(numericFileOrder)
    const archivos = await Promise.all(objects.map(loadProviderFile))

    return jsonResponse({ ok: true, etapa: stage.currentStage, archivos })
  } catch (error) {
    if (error instanceof InscreenHttpError) {
      return providerErrorResponse(error.message, error.status)
    }
    console.error(`GET InScreen provider ${kind} error:`, error)
    return providerErrorResponse("Error interno del proveedor InScreen.", 500)
  }
}
