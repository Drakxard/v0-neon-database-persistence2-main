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
            : isRecovering
              ? "Ya hay una carpeta guardada. Recupera el permiso del navegador para continuar sin volver a elegirla."
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
                ? "inline-flex h-11 items-center justify-center rounded-2xl border border-white/15 px-5 text-sm font-medium text-white transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
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

export function LocalWorkspaceProvider({
  enabled,
  children,
}: {
  enabled: boolean
  children: React.ReactNode
}) {
  const [bootState, setBootState] = useState<LocalWorkspaceBootState>(enabled ? "checking" : "ready")
  const [rootHandle, setRootHandle] = useState<FileSystemDirectoryHandle | null>(null)
  const [storedHandle, setStoredHandle] = useState<FileSystemDirectoryHandle | null>(null)
  const [permissionState, setPermissionState] = useState<PermissionState | "unsupported">(
    enabled ? "prompt" : "granted"
  )
  const [error, setError] = useState("")
  const isReady = !enabled || bootState === "ready" || bootState === "checking"

  useEffect(() => {
    if (!enabled) {
      setBootState("ready")
      return
    }

    let cancelled = false
    setBootState("checking")
    setError("")

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
          setRootHandle(null)
          setPermissionState(permission)
          setError("La carpeta local ya esta guardada, pero el navegador necesita recuperar el permiso.")
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

      if (cancelled) return
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

  const reselectWorkspace = async () => {
    try {
      setError("")
      setBootState("checking")
      const handle = await pickWorkspaceRootHandle()
      setRootHandle(handle)
      setStoredHandle(handle)
      setPermissionState("granted")
      setBootState("ready")
    } catch (workspaceError) {
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
        setRootHandle(null)
        setPermissionState(permission)
        setBootState("recover")
        setError("No se concedio permiso de lectura/escritura para la carpeta guardada.")
        return
      }

      await ensureWorkspaceSubdirectories(storedHandle)
      setRootHandle(storedHandle)
      setPermissionState("granted")
      setBootState("ready")
    } catch (workspaceError) {
      setRootHandle(null)
      setPermissionState("prompt")
      setBootState("recover")
      setError(workspaceError instanceof Error ? workspaceError.message : "No se pudo recuperar la carpeta local.")
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
      {enabled ? <LocalFetchInterceptor /> : null}
      {!enabled || isReady ? children : null}
      {enabled && bootState !== "ready" && bootState !== "checking" ? (
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
