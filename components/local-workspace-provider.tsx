"use client"

import { createContext, useContext, useEffect, useMemo, useState } from "react"

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

const LocalWorkspaceContext = createContext<LocalWorkspaceContextValue | null>(null)

function WorkspaceModal({
  isRecovering,
  error,
  onSelect,
}: {
  isRecovering: boolean
  error: string
  onSelect: () => Promise<void>
}) {
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/70 px-6">
      <div className="w-full max-w-lg rounded-3xl border border-white/10 bg-slate-900 p-6 text-white shadow-2xl">
        <p className="text-xs uppercase tracking-[0.28em] text-slate-400">Modo local</p>
        <h2 className="mt-3 text-2xl font-semibold">
          {isRecovering ? "Recuperar carpeta de trabajo" : "Elegi la carpeta de trabajo"}
        </h2>
        <p className="mt-3 text-sm text-slate-300">
          La app va a guardar y reutilizar una carpeta raiz local. Dentro de esa carpeta se crean o reutilizan
          automaticamente las subcarpetas `teoria/` y `practica/`.
        </p>
        {!supportsWorkspacePicker() ? (
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
          disabled={!supportsWorkspacePicker()}
          className="mt-6 inline-flex h-11 items-center justify-center rounded-2xl bg-sky-500 px-5 text-sm font-medium text-slate-950 transition hover:bg-sky-400 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isRecovering ? "Volver a seleccionar carpeta" : "Seleccionar carpeta"}
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
  const [isReady, setIsReady] = useState(!enabled)
  const [rootHandle, setRootHandle] = useState<FileSystemDirectoryHandle | null>(null)
  const [permissionState, setPermissionState] = useState<PermissionState | "unsupported">(
    enabled ? "prompt" : "granted"
  )
  const [needsPrompt, setNeedsPrompt] = useState(false)
  const [error, setError] = useState("")

  useEffect(() => {
    if (!enabled) return

    let cancelled = false

    const bootstrap = async () => {
      if (!supportsWorkspacePicker()) {
        if (cancelled) return
        setPermissionState("unsupported")
        setNeedsPrompt(true)
        setIsReady(false)
        return
      }

      try {
        const storedHandle = await loadWorkspaceHandle()
        if (!storedHandle) {
          if (cancelled) return
          setNeedsPrompt(true)
          setPermissionState("prompt")
          setIsReady(false)
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
          setNeedsPrompt(true)
          setIsReady(false)
          return
        }

        await ensureWorkspaceSubdirectories(storedHandle)
        if (cancelled) return
        setRootHandle(storedHandle)
        setPermissionState("granted")
        setNeedsPrompt(false)
        setIsReady(true)
      } catch (workspaceError) {
        if (cancelled) return
        setError(workspaceError instanceof Error ? workspaceError.message : "No se pudo restaurar la carpeta local.")
        setNeedsPrompt(true)
        setIsReady(false)
      }
    }

    void bootstrap()

    return () => {
      cancelled = true
    }
  }, [enabled])

  const reselectWorkspace = async () => {
    setError("")
    const handle = await pickWorkspaceRootHandle()
    setRootHandle(handle)
    setPermissionState("granted")
    setNeedsPrompt(false)
    setIsReady(true)
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
      {children}
      {enabled && needsPrompt ? (
        <WorkspaceModal isRecovering={permissionState !== "prompt"} error={error} onSelect={reselectWorkspace} />
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
