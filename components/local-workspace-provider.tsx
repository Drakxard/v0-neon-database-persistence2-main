"use client"

import { createContext, useContext, useEffect, useMemo, useState } from "react"
import { usePathname } from "next/navigation"
import QRCode from "qrcode"

import { LocalFetchInterceptor } from "@/components/local-fetch-interceptor"
import {
  clearLegacyInscreenBrowserHalf,
  ensureWorkspaceSubdirectories,
  loadInscreenFileHalf,
  loadDriveFileHalf,
  loadWorkspaceHandle,
  pickWorkspaceRootHandle,
  queryWorkspacePermission,
  requestWorkspacePermission,
  persistInscreenFileHalf,
  persistDriveFileHalf,
  removeDriveFileHalf,
  setReadyInscreenConfigHalf,
  getReadyInscreenConfigHalf,
  setReadyDriveConfigHalf,
  setReadyWorkspaceHandle,
  supportsWorkspacePicker,
} from "@/lib/local-workspace-client"
import { applyLocalDriveDuplicateCleanup, enqueueAllLocalMaterialsForDrive, getLocalDriveReferencedFileIds, getLocalDriveSyncSummary, getLocalWidgetTargetSyncSummary, processLocalDriveSyncQueue, processLocalWidgetTargetSyncQueue, refreshAllLocalMaterialWidgetTargets } from "@/lib/local-workspace-data"

type LocalWorkspaceContextValue = {
  isReady: boolean
  rootHandle: FileSystemDirectoryHandle | null
  permissionState: PermissionState | "unsupported"
  reselectWorkspace: () => Promise<void>
}

type LocalWorkspaceBootState = "checking" | "prompt" | "recover" | "unsupported" | "configure" | "ready"

type DriveStatus = { connected: boolean; email?: string; rootFolderName?: string; rootFolderLink?: string; error?: string }
type DriveSummary = { synced: number; pending: number; failed: number; errors: string[] }
type WidgetTargetSummary = { pending: number; failed: number; errors: string[] }
type ApiStatus = { groq: boolean; r2: boolean }

type InscreenConfigValues = {
  GROQ_API_KEY: string
  R2_BUCKET_NAME: string
  R2_ACCESS_KEY_ID: string
  R2_SECRET_ACCESS_KEY: string
  R2_ENDPOINT: string
}

const EMPTY_INSCREEN_CONFIG: InscreenConfigValues = {
  GROQ_API_KEY: "",
  R2_BUCKET_NAME: "",
  R2_ACCESS_KEY_ID: "",
  R2_SECRET_ACCESS_KEY: "",
  R2_ENDPOINT: "",
}

const INSCREEN_CONFIG_SKIPPED_KEY = "inscreen.config-skipped.v1"

function isInscreenConfigurationSkipped() {
  try {
    return window.localStorage.getItem(INSCREEN_CONFIG_SKIPPED_KEY) === "1"
  } catch {
    return false
  }
}

function setInscreenConfigurationSkipped(skipped: boolean) {
  try {
    if (skipped) window.localStorage.setItem(INSCREEN_CONFIG_SKIPPED_KEY, "1")
    else window.localStorage.removeItem(INSCREEN_CONFIG_SKIPPED_KEY)
  } catch {}
}

const LocalWorkspaceContext = createContext<LocalWorkspaceContextValue | null>(null)

function WorkspaceModal({
  bootState,
  error,
  canRecover,
  onRecover,
  onSelect,
}: {
  bootState: Exclude<LocalWorkspaceBootState, "ready">
  error: string
  canRecover: boolean
  onRecover: () => Promise<void>
  onSelect: () => Promise<void>
}) {
  const isChecking = bootState === "checking"
  const isRecovering = bootState === "recover"
  const isUnsupported = bootState === "unsupported"

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/25 px-6 backdrop-blur-sm">
      <div className="w-full max-w-lg rounded-3xl border border-slate-200 bg-white p-6 text-slate-900 shadow-2xl">
        <p className="text-xs uppercase tracking-[0.28em] text-sky-700">Modo local</p>
        <h2 className="mt-3 text-2xl font-semibold">
          {isChecking
            ? "Recuperando carpeta local"
            : isRecovering
              ? "Recuperar carpeta de trabajo"
              : "Elegi la carpeta de trabajo"}
        </h2>
        <p className="mt-3 text-sm text-slate-600">
          {isChecking
            ? "Comprobando si ya existe una carpeta local guardada y si conserva permisos de lectura y escritura."
            : isRecovering
              ? "Ya hay una carpeta guardada. Recupera el permiso del navegador para continuar sin volver a elegirla."
              : "La app va a guardar y reutilizar una carpeta raiz local. Dentro de esa carpeta se crean o reutilizan automaticamente las subcarpetas `cronograma/`, `teoria/`, `practica/`, `audio/` y `manifests/`."}
        </p>
        {isUnsupported ? (
          <p className="mt-4 rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            Este modo necesita un navegador Chromium con File System Access API.
          </p>
        ) : null}
        {error ? (
          <p className="mt-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>
        ) : null}
        <div className="mt-6 flex flex-wrap gap-3">
          {isRecovering ? (
            <button
              type="button"
              onClick={() => void onRecover()}
              disabled={isChecking || isUnsupported || !canRecover}
              className="inline-flex h-11 items-center justify-center rounded-2xl bg-sky-500 px-5 text-sm font-medium text-slate-950 transition hover:bg-sky-400 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Recuperar permiso
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => void onSelect()}
            disabled={isChecking || isUnsupported || !supportsWorkspacePicker()}
            className={
              isRecovering
                ? "inline-flex h-11 items-center justify-center rounded-2xl border border-slate-300 px-5 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                : "inline-flex h-11 items-center justify-center rounded-2xl bg-sky-500 px-5 text-sm font-medium text-slate-950 transition hover:bg-sky-400 disabled:cursor-not-allowed disabled:opacity-50"
            }
          >
            {isChecking ? "Comprobando..." : isRecovering ? "Cambiar carpeta" : "Seleccionar carpeta"}
          </button>
        </div>
      </div>
    </div>
  )
}

function InscreenConfigModal({
  step,
  values,
  error,
  saving,
  onChange,
  onBack,
  onNext,
  onSave,
  onSkip,
  qrDataUrl,
  pairingExpiresAt,
  devices,
  onRegenerateQr,
  onRevokeDevice,
  onFinish,
}: {
  step: number
  values: InscreenConfigValues
  error: string
  saving: boolean
  onChange: (field: keyof InscreenConfigValues, value: string) => void
  onBack: () => void
  onNext: () => void
  onSave: () => void
  onSkip: () => void
  qrDataUrl: string
  pairingExpiresAt: string
  devices: Array<{ deviceId: string; enabled: boolean; createdAt: string }>
  onRegenerateQr: () => void
  onRevokeDevice: (deviceId: string) => void
  onFinish: () => void
}) {
  const inputClass = "mt-2 h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-100"
  const secretField = (field: keyof InscreenConfigValues, label: string, placeholder = "") => (
    <label className="block text-sm font-medium text-slate-700">
      {label}
      <input type="password" autoComplete="off" value={values[field]} placeholder={placeholder} onChange={(event) => onChange(field, event.target.value)} className={inputClass} />
    </label>
  )

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center bg-slate-900/25 px-6 backdrop-blur-sm">
      <div className="w-full max-w-xl rounded-3xl border border-slate-200 bg-white p-7 text-slate-900 shadow-2xl">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-sky-700">Configuración InScreen</p>
            <h2 className="mt-2 text-2xl font-semibold">Conecta tus servicios</h2>
          </div>
          <span className="rounded-full bg-sky-50 px-3 py-1 text-sm font-medium text-sky-700">{step === 0 ? "Groq" : "Cloudflare R2"}</span>
        </div>
        <p className="mt-3 text-sm leading-6 text-slate-600">
          Tus credenciales se cifran en el servidor. `User.InScreen` conserva la Mitad A y Vercel instala la Mitad B como cookie HttpOnly, fuera del alcance del JavaScript.
        </p>
        <div className="mt-6 space-y-4">
          {step === 0 ? (
            <>
              <h3 className="text-lg font-semibold">Groq</h3>
              <p className="text-sm text-slate-600">Se usa para traducir el texto seleccionado en PDF.js.</p>
              {secretField("GROQ_API_KEY", "GROQ_API_KEY")}
            </>
          ) : null}
          {step === 1 ? (
            <>
              <h3 className="text-lg font-semibold">Cloudflare R2</h3>
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block text-sm font-medium text-slate-700">R2_BUCKET_NAME<input value={values.R2_BUCKET_NAME} onChange={(event) => onChange("R2_BUCKET_NAME", event.target.value)} className={inputClass} /></label>
                <label className="block text-sm font-medium text-slate-700">R2_ENDPOINT<input type="url" value={values.R2_ENDPOINT} placeholder="https://...r2.cloudflarestorage.com" onChange={(event) => onChange("R2_ENDPOINT", event.target.value)} className={inputClass} /></label>
                {secretField("R2_ACCESS_KEY_ID", "R2_ACCESS_KEY_ID")}
                {secretField("R2_SECRET_ACCESS_KEY", "R2_SECRET_ACCESS_KEY")}
              </div>
            </>
          ) : null}
          {step === 3 ? (
            <>
              <h3 className="text-lg font-semibold">Vincular telefono</h3>
              <p className="text-sm text-slate-600">Abri InScreen en Android y escanea este QR. Vence en cinco minutos y no contiene credenciales legibles.</p>
              <div className="flex min-h-64 items-center justify-center rounded-2xl border border-slate-200 bg-slate-50 p-4">
                {qrDataUrl ? <img src={qrDataUrl} alt="QR para vincular InScreen Android" className="h-60 w-60" /> : <p className="text-sm text-slate-500">Generando QR seguro...</p>}
              </div>
              {pairingExpiresAt ? <p className="text-center text-xs text-slate-500">Valido hasta {new Date(pairingExpiresAt).toLocaleTimeString()}</p> : null}
              <button type="button" onClick={onRegenerateQr} disabled={saving} className="h-10 w-full rounded-xl border border-slate-300 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40">Generar otro QR</button>
              {devices.length ? <div className="space-y-2">
                <p className="text-sm font-semibold text-slate-700">Dispositivos</p>
                {devices.map((device) => <div key={device.deviceId} className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 px-3 py-2 text-xs">
                  <span>{device.deviceId.slice(0, 8)} · {device.enabled ? "Activo" : "Revocado"}</span>
                  {device.enabled ? <button type="button" onClick={() => onRevokeDevice(device.deviceId)} className="font-semibold text-red-600">Revocar</button> : null}
                </div>)}
              </div> : null}
            </>
          ) : null}
        </div>
        {error ? <p className="mt-5 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p> : null}
        <div className="mt-7 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            {step < 2 ? <button type="button" onClick={onBack} disabled={saving} className="h-11 rounded-xl border border-slate-300 px-5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40">Volver a servicios</button> : null}
          </div>
          {step < 2 ? (
            <button type="button" onClick={onSave} disabled={saving} className="h-11 rounded-xl bg-sky-600 px-6 text-sm font-semibold text-white hover:bg-sky-500 disabled:opacity-50">{saving ? "Protegiendo..." : "Guardar"}</button>
          ) : step === 2 ? (
            <button type="button" onClick={onSave} disabled={saving} className="h-11 rounded-xl bg-sky-600 px-6 text-sm font-semibold text-white hover:bg-sky-500 disabled:opacity-50">Guardar</button>
          ) : <button type="button" onClick={onFinish} disabled={saving} className="h-11 rounded-xl bg-sky-600 px-6 text-sm font-semibold text-white hover:bg-sky-500 disabled:opacity-50">Finalizar</button>}
        </div>
      </div>
    </div>
  )
}

function ServicesPanel({ apis, drive, summary, widgetSummary, busy, error, driveCleanupMessage, onConfigureGroq, onConfigureR2, onConnect, onDisconnect, onSync, onCleanupDrive, onRetryWidgets, onClose }: {
  apis: ApiStatus
  drive: DriveStatus
  summary: DriveSummary
  widgetSummary: WidgetTargetSummary
  busy: boolean
  error: string
  driveCleanupMessage: string
  onConfigureGroq: () => void
  onConfigureR2: () => void
  onConnect: () => void
  onDisconnect: () => void
  onSync: () => void
  onCleanupDrive: () => void
  onRetryWidgets: () => void
  onClose: () => void
}) {
  const service = (name: string, detail: string, ok = true) => (
    <div className="flex items-center justify-between rounded-2xl border border-slate-200 px-4 py-3">
      <div><p className="font-medium">{name}</p><p className="text-xs text-slate-500">{detail}</p></div>
      <span className={ok ? "text-emerald-600" : "text-slate-400"}>{ok ? "✓ OK" : "OFF"}</span>
    </div>
  )
  return <div className="fixed inset-0 z-[110] flex items-center justify-center bg-slate-900/25 px-6 backdrop-blur-sm">
    <div className="w-full max-w-xl rounded-3xl border border-slate-200 bg-white p-7 text-slate-900 shadow-2xl">
      <p className="text-xs font-semibold uppercase tracking-[0.24em] text-sky-700">Servicios</p>
      <h2 className="mt-2 text-2xl font-semibold">Conexiones de este navegador</h2>
      <div className="mt-6 space-y-3">
        <button type="button" onClick={onConfigureGroq} className="block w-full text-left">{service("Groq", apis.groq ? "Configurado en User.InScreen" : "Selecciona para configurarlo", apis.groq)}</button>
        <button type="button" onClick={onConfigureR2} className="block w-full text-left">{service("Cloudflare R2", apis.r2 ? "Configurado en User.InScreen" : "Selecciona para configurarlo", apis.r2)}</button>
        {service("Google Drive", drive.connected ? `${drive.email} · ${drive.rootFolderName}` : "Sin cuenta conectada", drive.connected)}
      </div>
      <div className="mt-4 rounded-2xl bg-slate-50 p-4 text-sm">
        <p>Widgets InScreen · {widgetSummary.pending} pendientes · {widgetSummary.failed} con error</p>
        {widgetSummary.errors.map((message, index) => <p className="mt-2 text-xs text-amber-800" key={`${index}-${message}`}>{message}</p>)}
        {widgetSummary.pending > 0 || widgetSummary.failed > 0 ? <button type="button" onClick={onRetryWidgets} disabled={busy} className="mt-3 rounded-xl border border-slate-300 px-3 py-2 disabled:opacity-50">Reintentar widgets</button> : null}
      </div>
      {drive.connected ? <div className="mt-4 rounded-2xl bg-slate-50 p-4 text-sm">
        <p>{summary.synced} sincronizados · {summary.pending} pendientes · {summary.failed} con error</p>
        {summary.errors.length ? <div className="mt-3 space-y-1 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
          {summary.errors.map((message, index) => <p key={`${index}-${message}`}>{message}</p>)}
          <p className="pt-1 text-amber-700">Se reintentan al iniciar, ante el proximo cambio o manualmente.</p>
        </div> : null}
        <div className="mt-3 flex flex-wrap gap-2">
          {drive.rootFolderLink ? <a href={drive.rootFolderLink} target="_blank" rel="noreferrer" className="rounded-xl border border-slate-300 px-3 py-2">Abrir carpeta</a> : null}
          <button type="button" onClick={onSync} disabled={busy} className="rounded-xl border border-slate-300 px-3 py-2 disabled:opacity-50">Sincronizar existentes</button>
          <button type="button" onClick={onCleanupDrive} disabled={busy} className="rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-amber-900 disabled:opacity-50">Limpiar duplicados</button>
          <button type="button" onClick={onConnect} disabled={busy} className="rounded-xl border border-slate-300 px-3 py-2 disabled:opacity-50">Cambiar cuenta</button>
          <button type="button" onClick={onDisconnect} disabled={busy} className="rounded-xl border border-red-200 px-3 py-2 text-red-600 disabled:opacity-50">Desconectar</button>
        </div>
      </div> : <button type="button" onClick={onConnect} disabled={busy} className="mt-4 h-11 w-full rounded-xl bg-sky-600 px-5 font-semibold text-white disabled:opacity-50">Conectar Google Drive</button>}
      {driveCleanupMessage ? <p className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{driveCleanupMessage}</p> : null}
      {error ? <p className="mt-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p> : null}
      <div className="mt-6 flex justify-end"><button type="button" onClick={onClose} className="h-11 rounded-xl bg-slate-900 px-6 font-semibold text-white">Cerrar</button></div>
    </div>
  </div>
}

async function unlockWorkspaceInscreenConfig(handle: FileSystemDirectoryHandle): Promise<{ ok: boolean; missing?: boolean; error: string }> {
  await clearLegacyInscreenBrowserHalf()
  const fileHalf = await loadInscreenFileHalf(handle)
  if (!fileHalf) {
    setReadyInscreenConfigHalf("")
    return { ok: false, missing: true, error: "No se encontro una configuracion completa. Completa los tres pasos para crear User.InScreen." }
  }
  const response = await fetch("/api/inscreen/config/unlock", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fileHalf }),
  })
  const payload = await response.json().catch(() => null) as { configured?: boolean; error?: string } | null
  if (!response.ok || payload?.configured === false) {
    setReadyInscreenConfigHalf("")
    return { ok: false, error: payload?.error || "No se pudo desbloquear User.InScreen." }
  }
  setReadyInscreenConfigHalf(fileHalf)
  return { ok: true, error: "" }
}

export function LocalWorkspaceProvider({
  enabled,
  children,
}: {
  enabled: boolean
  children: React.ReactNode
}) {
  const pathname = usePathname()
  const [bootState, setBootState] = useState<LocalWorkspaceBootState>(enabled ? "checking" : "ready")
  const [rootHandle, setRootHandle] = useState<FileSystemDirectoryHandle | null>(null)
  const [storedHandle, setStoredHandle] = useState<FileSystemDirectoryHandle | null>(null)
  const [permissionState, setPermissionState] = useState<PermissionState | "unsupported">(
    enabled ? "prompt" : "granted"
  )
  const [error, setError] = useState("")
  const [configStep, setConfigStep] = useState(0)
  const [configValues, setConfigValues] = useState<InscreenConfigValues>(EMPTY_INSCREEN_CONFIG)
  const [savingConfig, setSavingConfig] = useState(false)
  const [qrDataUrl, setQrDataUrl] = useState("")
  const [pairingExpiresAt, setPairingExpiresAt] = useState("")
  const [providerDevices, setProviderDevices] = useState<Array<{ deviceId: string; enabled: boolean; createdAt: string }>>([])
  const [driveStatus, setDriveStatus] = useState<DriveStatus>({ connected: false })
  const [apiStatus, setApiStatus] = useState<ApiStatus>({ groq: false, r2: false })
  const [driveSummary, setDriveSummary] = useState<DriveSummary>({ synced: 0, pending: 0, failed: 0, errors: [] })
  const [driveCleanupMessage, setDriveCleanupMessage] = useState("")
  const [widgetTargetSummary, setWidgetTargetSummary] = useState<WidgetTargetSummary>({ pending: 0, failed: 0, errors: [] })
  const isReady = !enabled || (bootState === "ready" && Boolean(rootHandle) && permissionState === "granted")
  const canRenderBeforeWorkspaceReady = enabled && pathname === "/practice/viewer"

  useEffect(() => {
    if (!enabled) {
      setBootState("ready")
      return
    }

    let cancelled = false
    setReadyWorkspaceHandle(null)
    setBootState("checking")
    setError("")

    const bootstrap = async () => {
      if (!supportsWorkspacePicker()) {
        if (cancelled) return
        setReadyWorkspaceHandle(null)
        setPermissionState("unsupported")
        setBootState("unsupported")
        return
      }

      try {
        const storedHandle = await loadWorkspaceHandle()
        if (!storedHandle) {
          if (cancelled) return
          setStoredHandle(null)
          setPermissionState("prompt")
          setBootState("prompt")
          return
        }

        if (cancelled) return
        setStoredHandle(storedHandle)

        const permission = await queryWorkspacePermission(storedHandle)
        if (permission !== "granted") {
          if (cancelled) return
          setReadyWorkspaceHandle(null)
          setRootHandle(null)
          setPermissionState(permission)
          setError("La carpeta local ya esta guardada, pero el navegador necesita recuperar el permiso.")
          setBootState("recover")
          return
        }

        await ensureWorkspaceSubdirectories(storedHandle)
        if (cancelled) return
        await unlockWorkspaceInscreenConfig(storedHandle)
        setReadyDriveConfigHalf(await loadDriveFileHalf(storedHandle))
        if (isInscreenConfigurationSkipped()) setReadyInscreenConfigHalf("")
        setReadyWorkspaceHandle(storedHandle)
        setRootHandle(storedHandle)
        setPermissionState("granted")
        setBootState("ready")
      } catch (workspaceError) {
        if (cancelled) return
        setReadyWorkspaceHandle(null)
        setError(workspaceError instanceof Error ? workspaceError.message : "No se pudo restaurar la carpeta local.")
        setBootState("recover")
      }
    }

    void bootstrap()

    return () => {
      cancelled = true
    }
  }, [enabled])

  useEffect(() => {
    if (!enabled || !rootHandle) return

    let cancelled = false

    const validatePermission = async () => {
      const restoredPermission = await queryWorkspacePermission(rootHandle)
      if (restoredPermission === "granted") return

      if (cancelled) return
      setReadyWorkspaceHandle(null)
      setRootHandle(null)
      setStoredHandle(rootHandle)
      setPermissionState(restoredPermission)
      setBootState("recover")
      setError("Se perdio el permiso de la carpeta local. Recupera el permiso para continuar.")
    }

    const handleFocus = () => {
      void validatePermission()
    }

    window.addEventListener("focus", handleFocus)
    return () => {
      cancelled = true
      window.removeEventListener("focus", handleFocus)
    }
  }, [enabled, rootHandle])

  useEffect(() => {
    if (!enabled || pathname !== "/" || bootState !== "ready" || !rootHandle || permissionState !== "granted") return

    const reopenConfiguration = async (event: KeyboardEvent) => {
      if (event.key !== "|") return
      const target = event.target
      if (target instanceof Element && target.closest("input, textarea, select, [contenteditable='true']")) return
      event.preventDefault()
      setInscreenConfigurationSkipped(false)
      setConfigValues(EMPTY_INSCREEN_CONFIG)
      setQrDataUrl("")
      setPairingExpiresAt("")
      setError("")

      const unlocked = await unlockWorkspaceInscreenConfig(rootHandle)
      if (unlocked.ok) {
        setConfigStep(4)
        setBootState("configure")
        const [statusResponse, inscreenStatusResponse, summary, widgetSummary] = await Promise.all([
          fetch("/api/google/drive/status", { cache: "no-store" }),
          fetch("/api/inscreen/config/status", { cache: "no-store", headers: { "x-inscreen-config-half": getReadyInscreenConfigHalf() } }),
          getLocalDriveSyncSummary(),
          getLocalWidgetTargetSyncSummary(),
        ])
        setDriveStatus(await statusResponse.json().catch(() => ({ connected: false })))
        const inscreenStatus = await inscreenStatusResponse.json().catch(() => null) as { services?: ApiStatus } | null
        setApiStatus(inscreenStatus?.services ?? { groq: false, r2: false })
        setDriveSummary(summary)
        setWidgetTargetSummary(widgetSummary)
        return
      }

      setApiStatus({ groq: false, r2: false })
      setConfigStep(4)
      setError("")
      setBootState("configure")
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      void reopenConfiguration(event)
    }

    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [bootState, enabled, pathname, permissionState, rootHandle])

  useEffect(() => {
    if (!enabled || bootState !== "ready" || !rootHandle) return
    let cancelled = false
    const run = async () => {
      const fileHalf = await loadDriveFileHalf(rootHandle)
      setReadyDriveConfigHalf(fileHalf)
      if (!fileHalf) return
      const statusResponse = await fetch("/api/google/drive/status", { cache: "no-store" })
      const status = await statusResponse.json().catch(() => ({ connected: false })) as DriveStatus
      if (!cancelled) setDriveStatus(status)
      if (!status.connected) return
      const summary = await processLocalDriveSyncQueue()
      if (!cancelled) setDriveSummary(summary)
    }
    void run()
    return () => { cancelled = true }
  }, [bootState, enabled, rootHandle])

  useEffect(() => {
    if (!enabled || bootState !== "ready" || !rootHandle || !getReadyInscreenConfigHalf()) return
    void processLocalWidgetTargetSyncQueue().then(setWidgetTargetSummary)
  }, [bootState, enabled, rootHandle])

  const reselectWorkspace = async () => {
    try {
      setError("")
      setBootState("checking")
      const handle = await pickWorkspaceRootHandle()
      setReadyWorkspaceHandle(null)
      setReadyInscreenConfigHalf("")
      setRootHandle(handle)
      setStoredHandle(handle)
      setPermissionState("granted")
      await unlockWorkspaceInscreenConfig(handle)
      setReadyDriveConfigHalf(await loadDriveFileHalf(handle))
      setReadyWorkspaceHandle(handle)
      setBootState("ready")
    } catch (workspaceError) {
      setReadyWorkspaceHandle(null)
      setReadyInscreenConfigHalf("")
      setRootHandle(null)
      setPermissionState("prompt")
      setBootState(supportsWorkspacePicker() ? "prompt" : "unsupported")
      setError(workspaceError instanceof Error ? workspaceError.message : "No se pudo seleccionar la carpeta local.")
    }
  }

  const recoverWorkspacePermission = async () => {
    if (!storedHandle) {
      setError("No hay una carpeta guardada para recuperar. Selecciona una carpeta.")
      setBootState("prompt")
      return
    }

    try {
      setError("")
      setBootState("checking")
      const permission = await requestWorkspacePermission(storedHandle, "readwrite")
      if (permission !== "granted") {
        setReadyWorkspaceHandle(null)
        setReadyInscreenConfigHalf("")
        setRootHandle(null)
        setPermissionState(permission)
        setBootState("recover")
        setError("No se concedio permiso de lectura/escritura para la carpeta guardada.")
        return
      }

      await ensureWorkspaceSubdirectories(storedHandle)
      await unlockWorkspaceInscreenConfig(storedHandle)
      if (isInscreenConfigurationSkipped()) setReadyInscreenConfigHalf("")
      setReadyWorkspaceHandle(storedHandle)
      setRootHandle(storedHandle)
      setPermissionState("granted")
      setBootState("ready")
    } catch (workspaceError) {
      setReadyWorkspaceHandle(null)
      setRootHandle(null)
      setPermissionState("prompt")
      setBootState("recover")
      setError(workspaceError instanceof Error ? workspaceError.message : "No se pudo recuperar la carpeta local.")
    }
  }

  const nextConfigStep = () => {
    const requiredByStep: Array<Array<keyof InscreenConfigValues>> = [
      ["GROQ_API_KEY"],
      ["R2_BUCKET_NAME", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_ENDPOINT"],
    ]
    const missing = requiredByStep[configStep].find((field) => !configValues[field].trim())
    if (missing) {
      setError(`Completa ${missing} para continuar.`)
      return false
    }
    setError("")
    return true
  }

  const loadProviderDevices = async () => {
    const response = await fetch("/api/inscreen/provider/devices", { cache: "no-store" })
    const payload = await response.json().catch(() => null) as { devices?: Array<{ deviceId: string; enabled: boolean; createdAt: string }> } | null
    if (response.ok) setProviderDevices(payload?.devices ?? [])
  }

  const createPairingQr = async () => {
    setSavingConfig(true)
    setError("")
    try {
      const response = await fetch("/api/inscreen/provider/pairing/create", { method: "POST" })
      const payload = await response.json().catch(() => null) as { pairingUri?: string; expiresAt?: string; error?: string } | null
      if (!response.ok || !payload?.pairingUri || !payload.expiresAt) throw new Error(payload?.error || "No se pudo crear el QR.")
      setQrDataUrl(await QRCode.toDataURL(payload.pairingUri, { width: 480, margin: 2, errorCorrectionLevel: "M" }))
      setPairingExpiresAt(payload.expiresAt)
      await loadProviderDevices()
    } catch (pairingError) {
      setQrDataUrl("")
      setError(pairingError instanceof Error ? pairingError.message : "No se pudo crear el QR.")
    } finally {
      setSavingConfig(false)
    }
  }

  const saveInscreenConfiguration = async () => {
    if (!rootHandle || !nextConfigStep()) return
    try {
      setSavingConfig(true)
      setError("")
      const sealedResponse = await fetch("/api/inscreen/config/seal", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(getReadyInscreenConfigHalf() ? { "x-inscreen-config-half": getReadyInscreenConfigHalf() } : {}) },
        body: JSON.stringify(configValues),
      })
      const sealedPayload = await sealedResponse.json().catch(() => null) as { fileHalf?: string; error?: string } | null
      if (!sealedResponse.ok || !sealedPayload?.fileHalf) {
        throw new Error(sealedPayload?.error || "No se pudo proteger la configuracion.")
      }
      await persistInscreenFileHalf(rootHandle, sealedPayload.fileHalf)
      const unlocked = await unlockWorkspaceInscreenConfig(rootHandle)
      if (!unlocked.ok) throw new Error(unlocked.error)
      setInscreenConfigurationSkipped(false)
      setReadyWorkspaceHandle(rootHandle)
      setApiStatus((current) => ({ ...current, ...(configStep === 0 ? { groq: true } : { r2: true }) }))
      setConfigValues(EMPTY_INSCREEN_CONFIG)
      setConfigStep(4)
    } catch (configError) {
      setError(configError instanceof Error ? configError.message : "No se pudo guardar la configuracion InScreen.")
    } finally {
      setSavingConfig(false)
    }
  }

  const skipInscreenConfiguration = () => {
    if (!rootHandle) return
    setInscreenConfigurationSkipped(true)
    setReadyInscreenConfigHalf("")
    setConfigValues(EMPTY_INSCREEN_CONFIG)
    setConfigStep(0)
    setError("")
    setReadyWorkspaceHandle(rootHandle)
    setBootState("ready")
  }

  const finishInscreenConfiguration = () => {
    setConfigValues(EMPTY_INSCREEN_CONFIG)
    setQrDataUrl("")
    setPairingExpiresAt("")
    setError("")
    setBootState("ready")
  }

  const revokeProviderDevice = async (deviceId: string) => {
    setSavingConfig(true)
    setError("")
    try {
      const response = await fetch(`/api/inscreen/provider/devices/${encodeURIComponent(deviceId)}`, { method: "DELETE" })
      const payload = await response.json().catch(() => null) as { error?: string } | null
      if (!response.ok) throw new Error(payload?.error || "No se pudo revocar el dispositivo.")
      await loadProviderDevices()
    } catch (revokeError) {
      setError(revokeError instanceof Error ? revokeError.message : "No se pudo revocar el dispositivo.")
    } finally {
      setSavingConfig(false)
    }
  }

  const connectDrive = () => {
    if (!rootHandle) return
    setSavingConfig(true)
    setError("")
    const popup = window.open("/api/google/oauth/start", "connect-google-drive", "popup,width=560,height=720")
    if (!popup) { setSavingConfig(false); setError("El navegador bloqueo la ventana de Google."); return }
    const handleMessage = async (event: MessageEvent) => {
      if (event.origin !== window.location.origin || event.data?.type !== "drive-oauth") return
      window.removeEventListener("message", handleMessage)
      try {
        if (!event.data.ok || !event.data.fileHalf) throw new Error(event.data.error || "No se pudo conectar Google Drive.")
        await persistDriveFileHalf(rootHandle, String(event.data.fileHalf))
        setReadyDriveConfigHalf(String(event.data.fileHalf))
        const response = await fetch("/api/google/drive/status", { cache: "no-store" })
        setDriveStatus(await response.json())
        setDriveSummary(await getLocalDriveSyncSummary())
      } catch (driveError) { setError(driveError instanceof Error ? driveError.message : "No se pudo guardar la conexion.") }
      finally { setSavingConfig(false) }
    }
    window.addEventListener("message", handleMessage)
  }

  const disconnectDrive = async () => {
    if (!rootHandle) return
    setSavingConfig(true)
    await fetch("/api/google/drive/status", { method: "DELETE" }).catch(() => undefined)
    await removeDriveFileHalf(rootHandle)
    setReadyDriveConfigHalf("")
    setDriveStatus({ connected: false })
    setSavingConfig(false)
  }

  const syncDrive = async () => {
    setSavingConfig(true)
    setError("")
    try {
      await enqueueAllLocalMaterialsForDrive()
      setDriveSummary(await processLocalDriveSyncQueue())
      await refreshAllLocalMaterialWidgetTargets()
      setWidgetTargetSummary(await processLocalWidgetTargetSyncQueue())
    } catch (driveError) { setError(driveError instanceof Error ? driveError.message : "No se pudo sincronizar Drive.") }
    finally { setSavingConfig(false) }
  }

  const cleanupDriveDuplicates = async () => {
    if (!window.confirm("Se conservara un PDF por nombre en cada carpeta de Cursado2026. Las copias sobrantes se enviaran a la papelera de Drive. ¿Continuar?")) return
    setSavingConfig(true)
    setError("")
    setDriveCleanupMessage("")
    try {
      const referencedFileIds = await getLocalDriveReferencedFileIds()
      const response = await fetch("/api/google/drive/cleanup-duplicates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ referencedFileIds }),
      })
      const result = await response.json().catch(() => null) as { scannedFolders?: number; scannedPdfs?: number; duplicateGroups?: number; trashedFiles?: number; groups?: Array<{ keptFileId: string; trashedFileIds: string[] }>; error?: string } | null
      if (!response.ok) throw new Error(result?.error || "No se pudieron limpiar los duplicados de Drive.")
      await applyLocalDriveDuplicateCleanup(result?.groups ?? [])
      setDriveCleanupMessage(`Limpieza completa: ${result?.scannedPdfs ?? 0} PDF revisados en ${result?.scannedFolders ?? 0} carpetas; ${result?.trashedFiles ?? 0} duplicados enviados a la papelera.`)
    } catch (driveError) {
      setError(driveError instanceof Error ? driveError.message : "No se pudieron limpiar los duplicados de Drive.")
    } finally {
      setSavingConfig(false)
    }
  }

  const retryWidgets = async () => {
    setSavingConfig(true)
    setError("")
    try { setWidgetTargetSummary(await processLocalWidgetTargetSyncQueue()) }
    catch (widgetError) { setError(widgetError instanceof Error ? widgetError.message : "No se pudieron reintentar los widgets.") }
    finally { setSavingConfig(false) }
  }

  const value = useMemo<LocalWorkspaceContextValue>(
    () => ({
      isReady,
      rootHandle,
      permissionState,
      reselectWorkspace,
    }),
    [isReady, permissionState, rootHandle]
  )

  return (
    <LocalWorkspaceContext.Provider value={value}>
      {enabled ? <LocalFetchInterceptor /> : null}
      {!enabled || isReady || canRenderBeforeWorkspaceReady ? children : null}
      {enabled && bootState === "configure" && configStep === 4 ? (
        <ServicesPanel apis={apiStatus} drive={driveStatus} summary={driveSummary} widgetSummary={widgetTargetSummary} busy={savingConfig} error={error} driveCleanupMessage={driveCleanupMessage} onConfigureGroq={() => { setConfigValues(EMPTY_INSCREEN_CONFIG); setConfigStep(0) }} onConfigureR2={() => { setConfigValues(EMPTY_INSCREEN_CONFIG); setConfigStep(1) }} onConnect={connectDrive} onDisconnect={() => { void disconnectDrive() }} onSync={() => { void syncDrive() }} onCleanupDrive={() => { void cleanupDriveDuplicates() }} onRetryWidgets={() => { void retryWidgets() }} onClose={finishInscreenConfiguration} />
      ) : enabled && bootState === "configure" ? (
        <InscreenConfigModal
          step={configStep}
          values={configValues}
          error={error}
          saving={savingConfig}
          onChange={(field, value) => {
            setConfigValues((current) => ({ ...current, [field]: value }))
            setError("")
          }}
          onBack={() => {
            setError("")
            setConfigStep(4)
          }}
          onNext={() => { nextConfigStep() }}
          onSave={() => { void saveInscreenConfiguration() }}
          onSkip={skipInscreenConfiguration}
          qrDataUrl={qrDataUrl}
          pairingExpiresAt={pairingExpiresAt}
          devices={providerDevices}
          onRegenerateQr={() => { void createPairingQr() }}
          onRevokeDevice={(deviceId) => { void revokeProviderDevice(deviceId) }}
          onFinish={finishInscreenConfiguration}
        />
      ) : null}
      {enabled && bootState !== "ready" && bootState !== "checking" && bootState !== "configure" ? (
        <WorkspaceModal
          bootState={bootState}
          error={error}
          canRecover={Boolean(storedHandle)}
          onRecover={recoverWorkspacePermission}
          onSelect={reselectWorkspace}
        />
      ) : null}
    </LocalWorkspaceContext.Provider>
  )
}

export function useLocalWorkspace() {
  const context = useContext(LocalWorkspaceContext)
  if (!context) {
    throw new Error("useLocalWorkspace must be used within LocalWorkspaceProvider.")
  }
  return context
}
