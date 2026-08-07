import { timingSafeEqual } from "node:crypto"

import { InscreenHttpError } from "@/lib/inscreen-server"
import { selectIncrementalProviderObjects, type InscreenProviderFileKind } from "@/lib/inscreen-provider-selection"
import { downloadR2Object, listR2ObjectsByPrefix } from "@/lib/r2"

export type InscreenProviderKind = InscreenProviderFileKind

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

export async function handleInscreenProviderGet(request: Request, kind: InscreenProviderKind) {
  const unauthorized = authorizeProvider(request)
  if (unauthorized) return unauthorized

  try {
    const url = new URL(request.url)
    const subjectSegment = String(url.searchParams.get("materia") || "").trim()
    const rawDay = String(url.searchParams.get("dia") || "").trim()
    const rawLastFile = String(url.searchParams.get("ultimo") || "").trim()
    if (!/^[a-z0-9]{1,300}$/.test(subjectSegment)) {
      throw new InscreenHttpError(400, "Materia invalida.")
    }
    if (rawLastFile && !/^[1-9][0-9]*\.txt$/.test(rawLastFile)) {
      throw new InscreenHttpError(400, "El ultimo TXT es invalido.")
    }

    if (rawDay) {
      const day = Number(rawDay)
      if (!Number.isInteger(day) || day < 0 || day > 6) {
        throw new InscreenHttpError(400, "El dia debe ser un entero entre 0 y 6.")
      }
      const prefix = `InSreen/${subjectSegment}/${day}/${kind}/`
      const objects = (await listR2ObjectsByPrefix(prefix))
        .filter((object) => /^[1-9][0-9]*\.txt$/.test(object.key.slice(prefix.length)))
        .sort(numericFileOrder)
      const archivos = await Promise.all(objects.map(loadProviderFile))
      return jsonResponse({ ok: true, etapa: day, hayNuevos: archivos.length > 0, cambioEtapa: false, archivos })
    }

    const allObjects = await listR2ObjectsByPrefix(`InSreen/${subjectSegment}/`)
    const selected = selectIncrementalProviderObjects(allObjects, subjectSegment, kind, rawLastFile || null)
    const archivos = await Promise.all(selected.files.map(loadProviderFile))
    const nuevaEtapa = selected.newStage ? {
      etapa: selected.newStage.stage,
      archivos: await Promise.all(selected.newStage.files.map(loadProviderFile)),
    } : null
    return jsonResponse({
      ok: true,
      hayNuevos: archivos.length > 0 || Boolean(nuevaEtapa?.archivos.length),
      archivos,
      nuevaEtapa,
    })
  } catch (error) {
    if (error instanceof InscreenHttpError) {
      return providerErrorResponse(error.message, error.status)
    }
    console.error(`GET InScreen provider ${kind} error:`, error)
    return providerErrorResponse("Error interno del proveedor InScreen.", 500)
  }
}
