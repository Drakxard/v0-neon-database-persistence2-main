import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from "node:crypto"

import { RemoteFileNotFoundError } from "@/lib/remote-file-errors"
import {
  getInscreenR2Config,
  type InscreenR2Config,
  type InscreenUserConfig,
  withInscreenRuntimeConfig,
} from "@/lib/inscreen-user-config"
import { downloadR2Object, listR2ObjectsByPrefix, uploadR2Object } from "@/lib/r2"

const PAIRING_PREFIX = "manifests/inscreen/provider/pairings"
const DEVICE_PREFIX = "manifests/inscreen/provider/devices"
const PAIRING_TTL_MS = 5 * 60 * 1000
const SUBJECT_EXPORT_PREFIX = "manifests/inscreen/provider/subject-exports"
const SUBJECT_EXPORT_TTL_MS = 5 * 60 * 1000

type BootstrapPayload = {
  version: 1
  pairingId: string
  deviceId: string
  issuedAt: string
  expiresAt: string
  r2: InscreenR2Config
  groqApiKey: string
  markerApiKey: string
}

type ProviderPayload = {
  version: 1
  deviceId: string
  issuedAt: string
  r2: InscreenR2Config
  markerApiKey?: string
}

export type SubjectExportItem = {
  id: string
  name: string
  color: string
}

type SubjectExportState = {
  version: 1
  exportId: string
  tabName: string
  subjects: SubjectExportItem[]
  expiresAt: string
  usedAt: string | null
}

type PairingState = {
  version: 1
  pairingId: string
  deviceId: string
  status: "pending" | "active"
  installationId: string | null
  createdAt: string
  expiresAt: string
  activatedAt: string | null
}

export type ProviderDevice = {
  version: 1
  deviceId: string
  installationId: string
  enabled: boolean
  createdAt: string
  revokedAt: string | null
}

function secretFor(purpose: "bootstrap" | "provider" | "subject-export") {
  const secret = String(process.env.INSCREEN_PROVIDER_CAPSULE_SECRET || "").trim()
  if (Buffer.byteLength(secret, "utf8") < 32) {
    throw new Error("INSCREEN_PROVIDER_CAPSULE_SECRET debe tener al menos 32 caracteres.")
  }
  return createHash("sha256").update(`inscreen:${purpose}:v1\0`).update(secret).digest()
}

function seal(prefix: "ipb1" | "ipc1" | "ise1", purpose: "bootstrap" | "provider" | "subject-export", payload: unknown) {
  const iv = randomBytes(12)
  const cipher = createCipheriv("aes-256-gcm", secretFor(purpose), iv)
  cipher.setAAD(Buffer.from(prefix))
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(payload), "utf8"), cipher.final()])
  return [prefix, iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), encrypted.toString("base64url")].join(".")
}

function open<T>(token: string, prefix: "ipb1" | "ipc1" | "ise1", purpose: "bootstrap" | "provider" | "subject-export"): T {
  const [version, iv, tag, ciphertext] = String(token || "").split(".")
  if (version !== prefix || !iv || !tag || !ciphertext || token.length > 16_000) throw new Error("Credencial de proveedor invalida.")
  try {
    const decipher = createDecipheriv("aes-256-gcm", secretFor(purpose), Buffer.from(iv, "base64url"))
    decipher.setAAD(Buffer.from(prefix))
    decipher.setAuthTag(Buffer.from(tag, "base64url"))
    return JSON.parse(Buffer.concat([
      decipher.update(Buffer.from(ciphertext, "base64url")),
      decipher.final(),
    ]).toString("utf8")) as T
  } catch {
    throw new Error("Credencial de proveedor invalida.")
  }
}

function validId(value: string) {
  return /^[a-zA-Z0-9_-]{16,100}$/.test(value)
}

function pairingKey(id: string) {
  return `${PAIRING_PREFIX}/${id}.json`
}

function deviceKey(id: string) {
  return `${DEVICE_PREFIX}/${id}.json`
}

function subjectExportKey(id: string) {
  return `${SUBJECT_EXPORT_PREFIX}/${id}.json`
}

async function readJson<T>(key: string): Promise<{ value: T; etag: string | null }> {
  const object = await downloadR2Object(key)
  return { value: JSON.parse(object.buffer.toString("utf8")) as T, etag: object.etag }
}

async function writeJson(key: string, value: unknown, conditions: { ifNoneMatch?: string; ifMatch?: string } = {}) {
  await uploadR2Object({
    objectKey: key,
    mimeType: "application/json",
    body: JSON.stringify(value),
    ...conditions,
  })
}

export async function createProviderPairing(config: InscreenUserConfig, origin: string) {
  const pairingId = randomUUID().replaceAll("-", "")
  const deviceId = randomUUID().replaceAll("-", "")
  const now = new Date()
  const expiresAt = new Date(now.getTime() + PAIRING_TTL_MS).toISOString()
  const r2 = getInscreenR2Config(config)
  const state: PairingState = {
    version: 1,
    pairingId,
    deviceId,
    status: "pending",
    installationId: null,
    createdAt: now.toISOString(),
    expiresAt,
    activatedAt: null,
  }
  await withInscreenRuntimeConfig(r2, () => writeJson(pairingKey(pairingId), state, { ifNoneMatch: "*" }))
  const token = seal("ipb1", "bootstrap", {
    version: 1,
    pairingId,
    deviceId,
    issuedAt: state.createdAt,
    expiresAt,
    r2,
    groqApiKey: config.GROQ_API_KEY,
    markerApiKey: config.MARKER_API,
  } satisfies BootstrapPayload)
  const pairingUri = `inscreen://provider-pair?${new URLSearchParams({ base_url: origin, token }).toString()}`
  return { pairingUri, expiresAt }
}

export async function redeemProviderPairing(token: string, installationId: string, origin: string) {
  if (!validId(installationId)) throw new ProviderPairingError(400, "installationId invalido.")
  const payload = open<BootstrapPayload>(token, "ipb1", "bootstrap")
  if (payload.version !== 1 || !validId(payload.pairingId) || !validId(payload.deviceId)) throw new ProviderPairingError(400, "QR invalido.")
  if (Date.parse(payload.expiresAt) <= Date.now()) throw new ProviderPairingError(410, "El QR vencio.")

  return withInscreenRuntimeConfig(payload.r2, async () => {
    let pairing: { value: PairingState; etag: string | null }
    try {
      pairing = await readJson<PairingState>(pairingKey(payload.pairingId))
    } catch (error) {
      if (error instanceof RemoteFileNotFoundError) throw new ProviderPairingError(410, "El QR ya no esta disponible.")
      throw error
    }
    const state = pairing.value
    if (state.deviceId !== payload.deviceId || state.expiresAt !== payload.expiresAt) throw new ProviderPairingError(403, "QR rechazado.")
    if (state.status === "active" && state.installationId !== installationId) throw new ProviderPairingError(409, "El QR ya fue usado por otro dispositivo.")
    let activatedAt = state.activatedAt || new Date().toISOString()
    if (state.status === "pending") {
      activatedAt = new Date().toISOString()
      await writeJson(pairingKey(payload.pairingId), {
        ...state,
        status: "active",
        installationId,
        activatedAt,
      } satisfies PairingState, { ifMatch: pairing.etag || undefined })
    }
    try {
      const existingDevice = await readJson<ProviderDevice>(deviceKey(payload.deviceId))
      if (existingDevice.value.installationId !== installationId) throw new ProviderPairingError(409, "Dispositivo incompatible.")
    } catch (error) {
      if (!(error instanceof RemoteFileNotFoundError)) throw error
      await writeJson(deviceKey(payload.deviceId), {
        version: 1,
        deviceId: payload.deviceId,
        installationId,
        enabled: true,
        createdAt: activatedAt,
        revokedAt: null,
      } satisfies ProviderDevice, { ifNoneMatch: "*" })
    }
    const providerToken = seal("ipc1", "provider", {
      version: 1,
      deviceId: payload.deviceId,
      issuedAt: new Date().toISOString(),
      r2: payload.r2,
      markerApiKey: String(payload.markerApiKey || "").trim(),
    } satisfies ProviderPayload)
    return { providerBaseUrl: origin, providerToken, groqApiKey: payload.groqApiKey }
  })
}

export async function authorizeProviderToken(token: string, handler: () => Promise<Response>) {
  let payload: ProviderPayload
  try {
    payload = open<ProviderPayload>(token, "ipc1", "provider")
  } catch {
    throw new ProviderPairingError(401, "No autorizado.")
  }
  if (payload.version !== 1 || !validId(payload.deviceId)) throw new ProviderPairingError(401, "No autorizado.")
  return withInscreenRuntimeConfig({
    ...payload.r2,
    MARKER_API: String(payload.markerApiKey || "").trim(),
  }, async () => {
    try {
      const { value } = await readJson<ProviderDevice>(deviceKey(payload.deviceId))
      if (!value.enabled || value.deviceId !== payload.deviceId) throw new ProviderPairingError(401, "Dispositivo revocado.")
    } catch (error) {
      if (error instanceof ProviderPairingError) throw error
      if (error instanceof RemoteFileNotFoundError) throw new ProviderPairingError(401, "Dispositivo desconocido.")
      throw error
    }
    return handler()
  })
}

export async function listProviderDevices(config: InscreenUserConfig) {
  const r2 = getInscreenR2Config(config)
  return withInscreenRuntimeConfig(r2, async () => {
    const objects = await listR2ObjectsByPrefix(`${DEVICE_PREFIX}/`)
    const devices = await Promise.all(objects.filter((item) => item.key.endsWith(".json")).map(async (item) => {
      try { return (await readJson<ProviderDevice>(item.key)).value } catch { return null }
    }))
    return devices.filter((item): item is ProviderDevice => Boolean(item)).sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  })
}

export async function revokeProviderDevice(config: InscreenUserConfig, deviceId: string) {
  if (!validId(deviceId)) throw new ProviderPairingError(400, "deviceId invalido.")
  return withInscreenRuntimeConfig(getInscreenR2Config(config), async () => {
    const current = await readJson<ProviderDevice>(deviceKey(deviceId))
    await writeJson(deviceKey(deviceId), {
      ...current.value,
      enabled: false,
      revokedAt: new Date().toISOString(),
    } satisfies ProviderDevice, { ifMatch: current.etag || undefined })
  })
}

function normalizeSubjectExportItems(value: unknown) {
  if (!Array.isArray(value) || value.length === 0 || value.length > 100) {
    throw new ProviderPairingError(400, "La exportacion debe contener entre 1 y 100 materias.")
  }
  const ids = new Set<string>()
  return value.map((item) => {
    const candidate = item && typeof item === "object" ? item as Record<string, unknown> : {}
    const id = String(candidate.id || "").trim()
    const name = String(candidate.name || "").replace(/\s+/g, " ").trim()
    const color = String(candidate.color || "").trim()
    if (!/^[a-zA-Z0-9_-]{1,180}$/.test(id) || !name || name.length > 300 || !/^#[0-9a-fA-F]{6}$/.test(color) || ids.has(id)) {
      throw new ProviderPairingError(400, "La exportacion contiene una materia invalida.")
    }
    ids.add(id)
    return { id, name, color }
  })
}

export async function createSubjectExport(
  config: InscreenUserConfig,
  tabName: string,
  subjects: unknown,
  origin: string,
) {
  const exportId = randomUUID().replaceAll("-", "")
  const now = new Date()
  const expiresAt = new Date(now.getTime() + SUBJECT_EXPORT_TTL_MS).toISOString()
  const state: SubjectExportState = {
    version: 1,
    exportId,
    tabName: String(tabName || "").replace(/\s+/g, " ").trim().slice(0, 200) || "Pestana",
    subjects: normalizeSubjectExportItems(subjects),
    expiresAt,
    usedAt: null,
  }
  const r2 = getInscreenR2Config(config)
  await withInscreenRuntimeConfig(r2, () => writeJson(subjectExportKey(exportId), state, { ifNoneMatch: "*" }))
  const token = seal("ise1", "subject-export", {
    version: 1,
    exportId,
    expiresAt,
    r2,
  })
  return {
    exportUri: `inscreen://subject-export?${new URLSearchParams({ base_url: origin, token }).toString()}`,
    expiresAt,
    subjectCount: state.subjects.length,
  }
}

export async function redeemSubjectExport(token: string) {
  const payload = open<{ version: 1; exportId: string; expiresAt: string; r2: InscreenR2Config }>(token, "ise1", "subject-export")
  if (payload.version !== 1 || !validId(payload.exportId)) throw new ProviderPairingError(400, "QR de materias invalido.")
  if (Date.parse(payload.expiresAt) <= Date.now()) throw new ProviderPairingError(410, "El QR de materias vencio.")

  return withInscreenRuntimeConfig(payload.r2, async () => {
    let current: { value: SubjectExportState; etag: string | null }
    try {
      current = await readJson<SubjectExportState>(subjectExportKey(payload.exportId))
    } catch (error) {
      if (error instanceof RemoteFileNotFoundError) throw new ProviderPairingError(410, "El QR de materias ya no esta disponible.")
      throw error
    }
    if (current.value.usedAt || current.value.expiresAt !== payload.expiresAt) {
      throw new ProviderPairingError(409, "El QR de materias ya fue utilizado.")
    }
    await writeJson(subjectExportKey(payload.exportId), { ...current.value, usedAt: new Date().toISOString() }, { ifMatch: current.etag || undefined })
    return { version: 1, tabName: current.value.tabName, subjects: current.value.subjects }
  })
}

export function bearerToken(request: Request) {
  const match = /^Bearer\s+(.+)$/i.exec(String(request.headers.get("authorization") || "").trim())
  return match?.[1]?.trim() || ""
}

export class ProviderPairingError extends Error {
  constructor(public status: number, message: string) { super(message) }
}
