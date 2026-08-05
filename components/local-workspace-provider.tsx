"use client"

import { createContext, useContext, useEffect, useMemo, useState } from "react"
import { usePathname } from "next/navigation"

import { LocalFetchInterceptor } from "@/components/local-fetch-interceptor"
import {
  clearLegacyInscreenBrowserHalf,
  ensureWorkspaceSubdirectories,
  loadInscreenFileHalf,
  loadWorkspaceHandle,
  pickWorkspaceRootHandle,
  queryWorkspacePermission,
  requestWorkspacePermission,
  persistInscreenFileHalf,
  setReadyInscreenConfigHalf,
  setReadyWorkspaceHandle,
  supportsWorkspacePicker,
} from "@/lib/local-workspace-client"

type LocalWorkspaceContextValue = {
  isReady: boolean
  rootHandle: FileSystemDirectoryHandle | null
  permissionState: PermissionState | "unsupported"
  reselectWorkspace: () => Promise<void>
}

type LocalWorkspaceBootState = "checking" | "prompt" | "recover" | "unsupported" | "configure" | "ready"

type InscreenConfigValues = {
  GROQ_API_KEY: string
  MARKER_API: string
  R2_BUCKET_NAME: string
  R2_ACCESS_KEY_ID: string
  R2_SECRET_ACCESS_KEY: string
  R2_ENDPOINT: string
}

const EMPTY_INSCREEN_CONFIG: InscreenConfigValues = {
  GROQ_API_KEY: "",
  MARKER_API: "",
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
          <span className="rounded-full bg-sky-50 px-3 py-1 text-sm font-medium text-sky-700">Paso {step + 1} de 3</span>
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
              <h3 className="text-lg font-semibold">Marker de Datalab</h3>
              <p className="text-sm text-slate-600">Extrae el contenido de la página después del tiempo de lectura.</p>
              {secretField("MARKER_API", "marker_api / MARKER_API")}
            </>
          ) : null}
          {step === 2 ? (
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
        </div>
        {error ? <p className="mt-5 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p> : null}
        <div className="mt-7 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <button type="button" onClick={onSkip} disabled={saving} className="h-11 rounded-xl px-3 text-sm font-medium text-slate-500 hover:bg-slate-50 hover:text-slate-800 disabled:opacity-40">Omitir por ahora</button>
            <button type="button" onClick={onBack} disabled={saving || step === 0} className="h-11 rounded-xl border border-slate-300 px-5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40">Anterior</button>
          </div>
          {step < 2 ? (
            <button type="button" onClick={onNext} disabled={saving} className="h-11 rounded-xl bg-sky-600 px-6 text-sm font-semibold text-white hover:bg-sky-500">Siguiente</button>
          ) : (
            <button type="button" onClick={onSave} disabled={saving} className="h-11 rounded-xl bg-sky-600 px-6 text-sm font-semibold text-white hover:bg-sky-500 disabled:opacity-50">{saving ? "Protegiendo..." : "Guardar y continuar"}</button>
          )}
        </div>
      </div>
    </div>
  )
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

    const reopenConfiguration = (event: KeyboardEvent) => {
      if (event.key !== "|") return
      const target = event.target
      if (target instanceof Element && target.closest("input, textarea, select, [contenteditable='true']")) return
      event.preventDefault()
      setInscreenConfigurationSkipped(false)
      setReadyWorkspaceHandle(null)
      setReadyInscreenConfigHalf("")
      setConfigValues(EMPTY_INSCREEN_CONFIG)
      setConfigStep(0)
      setError("")
      setBootState("configure")
    }

    window.addEventListener("keydown", reopenConfiguration)
    return () => window.removeEventListener("keydown", reopenConfiguration)
  }, [bootState, enabled, pathname, permissionState, rootHandle])

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
      ["MARKER_API"],
      ["R2_BUCKET_NAME", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_ENDPOINT"],
    ]
    const missing = requiredByStep[configStep].find((field) => !configValues[field].trim())
    if (missing) {
      setError(`Completa ${missing} para continuar.`)
      return false
    }
    setError("")
    if (configStep < 2) setConfigStep((current) => current + 1)
    return true
  }

  const saveInscreenConfiguration = async () => {
    if (!rootHandle || !nextConfigStep()) return
    try {
      setSavingConfig(true)
      setError("")
      const sealedResponse = await fetch("/api/inscreen/config/seal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
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
      setConfigValues(EMPTY_INSCREEN_CONFIG)
      setReadyWorkspaceHandle(rootHandle)
      setBootState("ready")
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
      {enabled && bootState === "configure" ? (
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
            setConfigStep((current) => Math.max(0, current - 1))
          }}
          onNext={() => { nextConfigStep() }}
          onSave={() => { void saveInscreenConfiguration() }}
          onSkip={skipInscreenConfiguration}
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
