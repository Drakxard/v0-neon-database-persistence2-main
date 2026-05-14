"use client"

import { createContext, useContext, useEffect, useMemo, useState } from "react"

import { LocalFetchInterceptor } from "@/components/local-fetch-interceptor"
import {
  ensureWorkspaceSubdirectories,
  loadWorkspaceHandle,
  pickWorkspaceRootHandle,
  queryWorkspacePermission,
  requestWorkspacePermission,
  supportsWorkspacePicker,
} from "@/lib/local-workspace-client"

type LocalWorkspaceContextValue = {
  isReady: boolean
  rootHandle: FileSystemDirectoryHandle | null
  permissionState: PermissionState | "unsupported"
  reselectWorkspace: () => Promise<void>
}

type LocalWorkspaceBootState = "checking" | "prompt" | "recover" | "unsupported" | "ready"

const LocalWorkspaceContext = createContext<LocalWorkspaceContextValue | null>(null)

function WorkspaceModal({
  bootState,
  error,
  onSelect,
}: {
  bootState: Exclude<LocalWorkspaceBootState, "ready">
  error: string
  onSelect: () => Promise<void>
}) {
  const isChecking = bootState === "checking"
  const isRecovering = bootState === "recover"
  const isUnsupported = bootState === "unsupported"

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/70 px-6">
      <div className="w-full max-w-lg rounded-3xl border border-white/10 bg-slate-900 p-6 text-white shadow-2xl">
        <p className="text-xs uppercase tracking-[0.28em] text-slate-400">Modo local</p>
        <h2 className="mt-3 text-2xl font-semibold">
          {isChecking
            ? "Recuperando carpeta local"
            : isRecovering
              ? "Recuperar carpeta de trabajo"
              : "Elegi la carpeta de trabajo"}
        </h2>
        <p className="mt-3 text-sm text-slate-300">
          {isChecking
            ? "Comprobando si ya existe una carpeta local guardada y si conserva permisos de lectura y escritura."
            : "La app va a guardar y reutilizar una carpeta raiz local. Dentro de esa carpeta se crean o reutilizan automaticamente las subcarpetas `cronograma/`, `teoria/`, `practica/`, `audio/` y `manifests/`."}
        </p>
        {isUnsupported ? (
          <p className="mt-4 rounded-2xl border border-amber-400/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
            Este modo necesita un navegador Chromium con File System Access API.
          </p>
        ) : null}
        {error ? (
          <p className="mt-4 rounded-2xl border border-red-400/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">{error}</p>
        ) : null}
        <button
          type="button"
          onClick={() => void onSelect()}
          disabled={isChecking || isUnsupported || !supportsWorkspacePicker()}
          className="mt-6 inline-flex h-11 items-center justify-center rounded-2xl bg-sky-500 px-5 text-sm font-medium text-slate-950 transition hover:bg-sky-400 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isChecking
            ? "Comprobando..."
            : isRecovering
              ? "Volver a seleccionar carpeta"
              : "Seleccionar carpeta"}
        </button>
      </div>
    </div>
  )
}

export function LocalWorkspaceProvider({
  enabled,
  children,
}: {
  enabled: boolean
  children: React.ReactNode
}) {
  const [bootState, setBootState] = useState<LocalWorkspaceBootState>(enabled ? "checking" : "ready")
  const [rootHandle, setRootHandle] = useState<FileSystemDirectoryHandle | null>(null)
  const [permissionState, setPermissionState] = useState<PermissionState | "unsupported">(
    enabled ? "prompt" : "granted"
  )
  const [error, setError] = useState("")
  const isReady = !enabled || bootState === "ready"

  useEffect(() => {
    if (!enabled) {
      setBootState("ready")
      return
    }

    let cancelled = false
    setBootState("checking")

    const bootstrap = async () => {
      if (!supportsWorkspacePicker()) {
        if (cancelled) return
        setPermissionState("unsupported")
        setBootState("unsupported")
        return
      }

      try {
        const storedHandle = await loadWorkspaceHandle()
        if (!storedHandle) {
          if (cancelled) return
          setPermissionState("prompt")
          setBootState("prompt")
          return
        }

        let permission = await queryWorkspacePermission(storedHandle)
        if (permission !== "granted") {
          permission = await requestWorkspacePermission(storedHandle)
        }

        if (permission !== "granted") {
          if (cancelled) return
          setRootHandle(null)
          setPermissionState(permission)
          setBootState("recover")
          return
        }

        await ensureWorkspaceSubdirectories(storedHandle)
        if (cancelled) return
        setRootHandle(storedHandle)
        setPermissionState("granted")
        setBootState("ready")
      } catch (workspaceError) {
        if (cancelled) return
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

      const requestedPermission = await requestWorkspacePermission(rootHandle)
      if (requestedPermission === "granted") return

      if (cancelled) return
      setRootHandle(null)
      setPermissionState(requestedPermission)
      setBootState("recover")
      setError("Se perdio el permiso de la carpeta local. Vuelve a seleccionarla para continuar.")
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

  const reselectWorkspace = async () => {
    try {
      setError("")
      setBootState("checking")
      const handle = await pickWorkspaceRootHandle()
      setRootHandle(handle)
      setPermissionState("granted")
      setBootState("ready")
    } catch (workspaceError) {
      setRootHandle(null)
      setPermissionState("prompt")
      setBootState(supportsWorkspacePicker() ? "prompt" : "unsupported")
      setError(workspaceError instanceof Error ? workspaceError.message : "No se pudo seleccionar la carpeta local.")
    }
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
      {enabled && isReady ? <LocalFetchInterceptor /> : null}
      {!enabled || isReady ? children : null}
      {enabled && bootState !== "ready" ? (
        <WorkspaceModal bootState={bootState} error={error} onSelect={reselectWorkspace} />
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
