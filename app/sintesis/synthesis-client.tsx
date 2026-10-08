"use client"

import dynamic from "next/dynamic"
import { useRouter } from "next/navigation"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { ArrowLeft, Download, LoaderCircle, Mic, MicOff, Pencil, Trash2 } from "lucide-react"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { fetchSubjectMaterialContainers } from "@/lib/material-containers-client"
import { requireOkJson } from "@/lib/client/api"
import type { SubjectDayMaterial } from "@/lib/study-types"
import { reconcileSynthesisMaterials, recordSynthesisRemovals, removeSynthesisNode } from "@/lib/synthesis-material-links"
import { readMaterialSynthesis, SYNTHESIS_MATERIALS_CHANGED_EVENT } from "@/lib/client/synthesis-materials"
import backgroundImage from "../../sintesis/sintesis-fondo.jpg"
import { buildSynthesisLocalStorageKey, buildSynthesisReturnTokenStorageKey, type SynthesisContext } from "@/lib/synthesis-context"
import { deleteSynthesisImage } from "@/lib/client/synthesis-images"
import { createAsyncLocalAutosave } from "@/lib/client/async-local-autosave"
import { getSynthesisFolderStore } from "@/lib/client/synthesis-persistence"
import { synthesisContent, type FolderSynthesis } from "@/lib/client/synthesis-folder-store"
import { syncSynthesis, SYNTHESIS_SYNC_EVENT } from "@/lib/client/synthesis-sync"
import { parseStoredSynthesisWorkspace, preserveSynthesisCopy, type SynthesisLocalCopy } from "@/lib/client/synthesis-local-copies"
import {
  SYNTHESIS_WORKSPACE_PENDING_KEY, SYNTHESIS_WORKSPACE_STORAGE_KEY, childrenOf,
  createEmptySynthesisWorkspace, createSynthesisId, deriveSynthesisNodes, ensureSynthesisDocument,
  extractSynthesisBranchDocument, findEditedSynthesisNode, normalizeSynthesisWorkspace, repairSynthesisLayout,
  replaceSynthesisBranch, scaleSynthesisWorkspace,
  referencedLocalImageIds,
  type SynthesisWorkspaceV2, type TiptapJSON,
} from "@/lib/synthesis-workspace"
import { exportSynthesisEditorSvg, type SynthesisSvgProgress } from "@/lib/client/synthesis-svg"
import { useSynthesisSpeech } from "@/lib/client/synthesis-speech"
import { voiceNodePath, type VoiceDestination } from "@/lib/synthesis-voice-navigation"
import styles from "./sintesis.module.css"

const SimpleEditor = dynamic(
  () => import("@/components/tiptap-templates/simple/simple-editor").then((module) => module.SimpleEditor),
  { ssr: false, loading: () => <div className={styles.editorLoading}>Abriendo editor…</div> }
)

type Drag = { id: string; startX: number; startY: number; originX: number; originY: number; moved: boolean }
const SAVE_ERROR_MESSAGE = "No se pudo guardar en la carpeta del dispositivo. Reintentá con Ctrl+S antes de salir."
type EditorSession = { nodeId: string | null; document: TiptapJSON; baseDocument: TiptapJSON; normalizationId: string; returnParentId: string | null; key: number }

function readLocalWorkspace(key: string) {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) || "null")
    return parsed ? repairSynthesisLayout(parseStoredSynthesisWorkspace(JSON.stringify(parsed)).workspace) : null
  } catch { return null }
}

export function SynthesisClient({ context, legacyReturnToken }: { context: SynthesisContext; legacyReturnToken: string }) {
  const router = useRouter()
  const storageKey = buildSynthesisLocalStorageKey(SYNTHESIS_WORKSPACE_STORAGE_KEY, context)
  const pendingKey = buildSynthesisLocalStorageKey(SYNTHESIS_WORKSPACE_PENDING_KEY, context)
  const returnTokenKey = buildSynthesisReturnTokenStorageKey(context)
  const [workspace, setWorkspace] = useState(createEmptySynthesisWorkspace)
  const workspaceRef = useRef(workspace)
  const folderBaseRef = useRef<string | null>(null)
  const preservedEmergencyRef = useRef(false)
  const [message, setMessage] = useState("")
  const [exportingSvg, setExportingSvg] = useState(false)
  const exportingSvgRef = useRef(false)
  const [exportProgress, setExportProgress] = useState<SynthesisSvgProgress>({ percent: 0, label: "Preparando apunte…" })
  const [cancellingExport, setCancellingExport] = useState(false)
  const exportControllerRef = useRef<AbortController | null>(null)
  useEffect(() => () => exportControllerRef.current?.abort(), [])
  const [loadState, setLoadState] = useState<"loading" | "ready" | "error">("loading")
  const [savedWeeks, setSavedWeeks] = useState<number[]>([])
  const [retry, setRetry] = useState(0)
  const [trash, setTrash] = useState<SynthesisLocalCopy[] | null>(null)
  const [topicsOpen, setTopicsOpen] = useState(false)
  const [suggestedNodeIds, setSuggestedNodeIds] = useState<string[]>([])
  const voiceRequestRef = useRef<AbortController | null>(null)
  const voiceSequenceRef = useRef(0)
  const stageEmergencyDraft = () => {
    try {
      if (!preservedEmergencyRef.current) {
        const previous = localStorage.getItem(pendingKey)
        if (previous) preserveSynthesisCopy(localStorage, pendingKey, previous)
        preservedEmergencyRef.current = true
      }
      localStorage.setItem(pendingKey, JSON.stringify({ workspace: workspaceRef.current, folderBase: folderBaseRef.current }))
    }
    catch { /* The folder remains the primary save target if browser storage is full. */ }
  }
  const autosave = useMemo(() => createAsyncLocalAutosave(async () => {
    const snapshot = structuredClone(workspaceRef.current)
    const folder = await getSynthesisFolderStore()
    await folder.save(context, snapshot)
    // Emergency drafts are staged synchronously; refresh the auxiliary cache
    // only after the original data has been migrated and the folder verified.
    try { localStorage.setItem(storageKey, JSON.stringify(snapshot)) }
    catch { /* The folder remains the primary save target if browser storage is full. */ }
    folderBaseRef.current = synthesisContent(snapshot)
    if (synthesisContent(workspaceRef.current) === folderBaseRef.current) {
      try { localStorage.removeItem(pendingKey) } catch { /* A stale emergency draft is not authoritative. */ }
    } else stageEmergencyDraft()
    void syncSynthesis(context)
  }, (status) => {
    if (status === "pending") stageEmergencyDraft()
    if (status === "error") setMessage(SAVE_ERROR_MESSAGE)
    else if (status === "saved") setMessage((current) => current === SAVE_ERROR_MESSAGE ? "" : current)
  }), [pendingKey, storageKey])
  const [currentParentId, setCurrentParentId] = useState<string | null>(null)
  const [editorSession, setEditorSession] = useState<EditorSession | null>(null)
  const [drag, setDrag] = useState<Drag | null>(null)
  const suppressClickRef = useRef(false)
  const editorHistoryRef = useRef(false)
  const removedImageIdsRef = useRef(new Set<string>())
  const editorOpenRef = useRef(false)
  const nodes = useMemo(() => deriveSynthesisNodes(workspace.document), [workspace.document])

  const acceptWorkspace = useCallback(async (input: SynthesisWorkspaceV2) => {
    const normalized = normalizeSynthesisWorkspace(input)
    workspaceRef.current = normalized
    setWorkspace(normalized)
    autosave.markDirty()
    if (!await autosave.flush()) throw new Error(SAVE_ERROR_MESSAGE)
    return normalized
  }, [autosave])

  useEffect(() => {
    const sync = () => { if (!editorOpenRef.current && !autosave.dirty) void syncSynthesis(context) }
    let disposed = false
    const status = async (event: Event) => {
      const detail = (event as CustomEvent<{ key: string; error?: string }>).detail
      if (detail.key !== storageKey) return
      // R2 is an opportunistic backup. Its conflicts keep both copies, but are
      // not actionable from this screen, so do not surface them as a notice.
      if (detail.error) return
      if (!editorOpenRef.current && !autosave.dirty) {
        try {
          const record = await (await getSynthesisFolderStore()).read(context)
          if (disposed || editorOpenRef.current || autosave.dirty) return
          if (record) {
            folderBaseRef.current = synthesisContent(record.workspace)
            const next = repairSynthesisLayout(record.workspace)
            workspaceRef.current = next; setWorkspace(next)
          }
        } catch (error) { if (!disposed) setMessage(error instanceof Error ? error.message : SAVE_ERROR_MESSAGE) }
      }
    }
    window.addEventListener(SYNTHESIS_SYNC_EVENT, status)
    window.addEventListener("online", sync)
    window.addEventListener("focus", sync)
    const timer = window.setInterval(sync, 30_000)
    return () => {
      disposed = true
      window.removeEventListener(SYNTHESIS_SYNC_EVENT, status)
      window.removeEventListener("online", sync)
      window.removeEventListener("focus", sync)
      window.clearInterval(timer)
    }
  }, [autosave, context.subjectId, context.weekNumber, storageKey])

  useEffect(() => {
    let disposed = false
    const localWeeks = new Set<number>([context.weekNumber])
    void getSynthesisFolderStore().then((folder) => folder.listWeeks(context.subjectId)).then((weeks) => {
      weeks.forEach((week) => localWeeks.add(week))
      if (!disposed) setSavedWeeks((previous) => [...new Set([...previous, ...localWeeks])].sort((a, b) => b - a))
    }).catch((error) => { if (!disposed) setMessage(error instanceof Error ? error.message : SAVE_ERROR_MESSAGE) })
    setSavedWeeks([...localWeeks].sort((a, b) => b - a))
    const params = new URLSearchParams({ subjectId: context.subjectId, weekNumber: String(context.weekNumber), listWeeks: "true" })
    void fetch(`/api/inscreen/synthesis-tree?${params}`, { cache: "no-store" })
      .then((response) => requireOkJson<{ weeks: Array<{ weekNumber: number }> }>(response, "No se pudieron consultar las semanas guardadas."))
      .then(({ weeks }) => {
        if (!disposed) setSavedWeeks([...new Set([...localWeeks, ...weeks.map((week) => week.weekNumber)])].sort((a, b) => b - a))
      }).catch(() => { /* The sync status reports unavailable R2; local weeks remain accessible. */ })
    return () => { disposed = true }
  }, [context.subjectId, context.weekNumber, retry])

  useEffect(() => {
    if (currentParentId && !nodes.some((node) => node.id === currentParentId)) setCurrentParentId(null)
  }, [currentParentId, nodes])

  useEffect(() => {
    let disposed = false
    let loading = false
    const refresh = async () => {
      if (loading || editorOpenRef.current || autosave.dirty) return
      loading = true
      try {
        let record: FolderSynthesis | null = null
        try {
          record = await (await getSynthesisFolderStore()).read(context)
        } catch (error) {
          const fallback = readLocalWorkspace(pendingKey) ?? readLocalWorkspace(storageKey)
          if (!fallback) throw error
          if (disposed || editorOpenRef.current || autosave.dirty) return
          workspaceRef.current = fallback; setWorkspace(fallback); setLoadState("ready")
          setMessage(SAVE_ERROR_MESSAGE)
          return
        }
        if (disposed || editorOpenRef.current || autosave.dirty) return
        folderBaseRef.current = synthesisContent(record?.workspace ?? null)
        // Migration has already recovered compatible crash drafts. A leftover
        // browser copy must not override a newer file from this folder.
        const local = record ? repairSynthesisLayout(record.workspace) : createEmptySynthesisWorkspace()
        workspaceRef.current = local; setWorkspace(local); setLoadState("ready")
        const synchronized = await syncSynthesis(context)
        if (disposed || editorOpenRef.current || autosave.dirty) return
        const loaded = await readMaterialSynthesis(context)
        if (disposed || editorOpenRef.current || autosave.dirty) return
        if (loaded) { workspaceRef.current = loaded; setWorkspace(loaded); setLoadState("ready") }
        if (!synchronized) return
        setLoadState("ready")
        const params = new URLSearchParams({ subjectId: context.subjectId, weekNumber: String(context.weekNumber), scope: "week" })
        const results = await Promise.allSettled([
          fetchSubjectMaterialContainers(context.subjectId),
          fetch(`/api/subject-day-materials?${params}`, { cache: "no-store" })
            .then((response) => requireOkJson<SubjectDayMaterial[]>(response, "No se pudieron cargar los PDF de Síntesis.")),
        ])
        const [containers, materials] = results
        if (containers.status === "rejected") throw containers.reason
        if (materials.status === "rejected") throw materials.reason
        if (disposed || editorOpenRef.current || autosave.dirty) return
        const latest = await readMaterialSynthesis(context) ?? workspaceRef.current
        if (disposed || editorOpenRef.current || autosave.dirty) return
        const reconciled = reconcileSynthesisMaterials(latest, containers.value, materials.value)
        if (JSON.stringify(reconciled) !== JSON.stringify(latest)) await acceptWorkspace(reconciled)
      } catch (error) {
        if (!disposed) { setMessage(error instanceof Error ? error.message : "No se pudo actualizar Síntesis."); setLoadState((state) => state === "loading" ? "error" : state) }
      } finally { loading = false }
    }
    const onStorage = (event: StorageEvent) => {
      if (event.key !== storageKey || editorOpenRef.current || autosave.dirty) return
      void refresh()
    }
    void refresh()
    window.addEventListener("focus", refresh)
    window.addEventListener("storage", onStorage)
    window.addEventListener(SYNTHESIS_MATERIALS_CHANGED_EVENT, refresh)
    return () => {
      disposed = true
      window.removeEventListener("focus", refresh)
      window.removeEventListener("storage", onStorage)
      window.removeEventListener(SYNTHESIS_MATERIALS_CHANGED_EVENT, refresh)
    }
  }, [acceptWorkspace, autosave, context.subjectId, context.weekNumber, storageKey, retry])

  useEffect(() => {
    if (legacyReturnToken) sessionStorage.setItem(returnTokenKey, legacyReturnToken)
    const canonicalParams = new URLSearchParams({
      subjectId: context.subjectId,
      weekNumber: String(context.weekNumber),
    })
    if (window.location.search !== `?${canonicalParams.toString()}`) {
      router.replace(`/sintesis?${canonicalParams.toString()}`)
    }
  }, [context.subjectId, context.weekNumber, legacyReturnToken, returnTokenKey, router])

  useEffect(() => {
    const persistBeforeLeaving = (event: BeforeUnloadEvent) => {
      if (!autosave.dirty) return
      autosave.flush()
      if (autosave.dirty) {
        event.preventDefault()
        event.returnValue = ""
      }
    }
    const flush = () => { autosave.flush() }
    const onVisibility = () => { if (document.visibilityState === "hidden") flush() }
    window.addEventListener("pagehide", flush)
    window.addEventListener("beforeunload", persistBeforeLeaving)
    document.addEventListener("visibilitychange", onVisibility)
    return () => {
      flush()
      window.removeEventListener("pagehide", flush)
      window.removeEventListener("beforeunload", persistBeforeLeaving)
      document.removeEventListener("visibilitychange", onVisibility)
    }
  }, [autosave])

  const closeEditor = useCallback(async () => {
    const session = editorSession
    if (!session) return
    if (!await autosave.flush()) return
    const removedImageIds = [...removedImageIdsRef.current]
    removedImageIdsRef.current.clear()
    setCurrentParentId(session.returnParentId); setEditorSession(null); editorHistoryRef.current = false; editorOpenRef.current = false
    window.dispatchEvent(new Event(SYNTHESIS_MATERIALS_CHANGED_EVENT))
    await Promise.allSettled(removedImageIds.map(deleteSynthesisImage))
  }, [autosave, editorSession])

  useEffect(() => {
    const onPopState = async () => {
      if (!editorHistoryRef.current) return
      if (!await autosave.flush()) {
        window.history.pushState({ synthesisEditor: true }, "")
        return
      }
      void closeEditor()
    }
    window.addEventListener("popstate", onPopState)
    return () => window.removeEventListener("popstate", onPopState)
  }, [autosave, closeEditor])

  const openEditor = useCallback((nodeId: string | null) => {
    if (loadState !== "ready") return
    editorOpenRef.current = true
    const document = nodeId ? extractSynthesisBranchDocument(workspaceRef.current.document, nodeId) : workspaceRef.current.document
    removedImageIdsRef.current.clear()
    setEditorSession({ nodeId, document, baseDocument: workspaceRef.current.document, normalizationId: createSynthesisId(), returnParentId: currentParentId, key: Date.now() })
    window.history.pushState({ synthesisEditor: true }, ""); editorHistoryRef.current = true
  }, [currentParentId, loadState])

  const updateEditorDocument = useCallback((documentInput: TiptapJSON) => {
    const session = editorSession
    if (!session) return
    let firstGeneratedId = true
    const document = ensureSynthesisDocument(documentInput, () => {
      if (firstGeneratedId) { firstGeneratedId = false; return session.normalizationId }
      return createSynthesisId()
    })
    const completeDocument = session.nodeId ? replaceSynthesisBranch(session.baseDocument, session.nodeId, document) : document
    const previousImageIds = new Set(referencedLocalImageIds(workspaceRef.current.document))
    const nextImageIds = new Set(referencedLocalImageIds(completeDocument))
    for (const id of previousImageIds) if (!nextImageIds.has(id)) removedImageIdsRef.current.add(id)
    for (const id of nextImageIds) removedImageIdsRef.current.delete(id)
    const editedNodeId = findEditedSynthesisNode(workspaceRef.current.document, completeDocument, session.nodeId)
    const next = recordSynthesisRemovals(workspaceRef.current, completeDocument)
    if (editedNodeId) next.lastEditedNodeId = editedNodeId
    workspaceRef.current = next
    setWorkspace(next)
    autosave.markDirty()
  }, [autosave, editorSession])

  const goHome = useCallback(async () => {
    if (!await autosave.flush()) return
    const returnToken = sessionStorage.getItem(returnTokenKey) || legacyReturnToken
    sessionStorage.removeItem(returnTokenKey)
    router.push(returnToken ? `/?returnToken=${encodeURIComponent(returnToken)}` : "/")
  }, [autosave, legacyReturnToken, returnTokenKey, router])

  const navigateToNode = useCallback((nodeId: string) => {
    if (!nodes.some((node) => node.id === nodeId)) return
    setCurrentParentId(nodeId)
    setTopicsOpen(false)
    setSuggestedNodeIds([])
  }, [nodes])

  const handleVoicePhrase = useCallback(async (phrase: string) => {
    if (loadState !== "ready" || editorOpenRef.current) return
    voiceSequenceRef.current += 1
    const sequence = voiceSequenceRef.current
    voiceRequestRef.current?.abort()
    voiceRequestRef.current = null
    const controller = new AbortController()
    voiceRequestRef.current = controller
    try {
      const response = await fetch("/api/synthesis-voice", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subjectId: context.subjectId,
          weekNumber: context.weekNumber,
          transcript: phrase,
          currentNodeId: currentParentId,
          lastEditedNodeId: workspaceRef.current.lastEditedNodeId,
          nodes: nodes.map((node) => ({ id: node.id, parentId: node.parentId, name: node.name.slice(0, 300) })),
        }),
        signal: controller.signal,
      })
      const result = await response.json() as VoiceDestination & { error?: string; upstreamStatus?: number }
      if (!response.ok) {
        throw new Error(`${result.error || "No se pudo interpretar el comando."} HTTP ${response.status}${
          result.upstreamStatus ? `, AI Gateway HTTP ${result.upstreamStatus}` : ""
        }`)
      }
      if (sequence !== voiceSequenceRef.current || editorOpenRef.current) return
      if (result.action === "navigate" && nodes.some((node) => node.id === result.nodeId)) navigateToNode(result.nodeId)
      else if (result.action === "topics") { setSuggestedNodeIds([]); setTopicsOpen(true) }
      else if (result.action === "edit") { setTopicsOpen(false); openEditor(currentParentId) }
      else if (result.action === "suggest" && Array.isArray(result.nodeIds)) {
        setSuggestedNodeIds(result.nodeIds.filter((id) => typeof id === "string" && nodes.some((node) => node.id === id)))
        setTopicsOpen(true)
      }
    } catch (error) {
      if (controller.signal.aborted || sequence !== voiceSequenceRef.current) return
      console.error("[Síntesis voz] No se pudo interpretar el comando", error)
    } finally { if (voiceRequestRef.current === controller) voiceRequestRef.current = null }
  }, [context.subjectId, context.weekNumber, currentParentId, loadState, navigateToNode, nodes, openEditor])

  const speech = useSynthesisSpeech(loadState === "ready" && !editorSession, handleVoicePhrase)

  useEffect(() => () => { voiceRequestRef.current?.abort() }, [])
  useEffect(() => {
    if (speech.enabled && !editorSession) return
    voiceSequenceRef.current += 1
    voiceRequestRef.current?.abort()
    voiceRequestRef.current = null
  }, [speech.enabled, editorSession])

  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
        event.preventDefault()
        autosave.flush()
        return
      }
      if (event.key === "Escape") {
        event.preventDefault()
        if (editorSession) { window.history.back(); return }
        if (topicsOpen) { setTopicsOpen(false); return }
        if (currentParentId) { setCurrentParentId(nodes.find((node) => node.id === currentParentId)?.parentId ?? null); return }
        void goHome(); return
      }
      if ((!event.ctrlKey && !event.metaKey) || editorSession || loadState !== "ready") return
      const increase = event.key === "+" || event.key === "=" || event.code === "NumpadAdd"
      const decrease = event.key === "-" || event.code === "NumpadSubtract"
      if (!increase && !decrease) return
      event.preventDefault()
      void acceptWorkspace(scaleSynthesisWorkspace(workspaceRef.current, workspaceRef.current.defaultScale + (increase ? 0.1 : -0.1))).catch(() => setMessage(SAVE_ERROR_MESSAGE))
    }
    window.addEventListener("keydown", keydown, { passive: false })
    return () => window.removeEventListener("keydown", keydown)
  }, [acceptWorkspace, autosave, currentParentId, editorSession, goHome, nodes, loadState, topicsOpen])

  const downloadSvg = async () => {
    if (exportingSvgRef.current) return
    exportingSvgRef.current = true
    const controller = new AbortController()
    exportControllerRef.current = controller
    setExportProgress({ percent: 0, label: "Preparando apunte…" })
    setCancellingExport(false)
    setExportingSvg(true)
    try {
      await exportSynthesisEditorSvg({ signal: controller.signal, onProgress: setExportProgress })
    } catch (error) {
      if (!controller.signal.aborted) setMessage(error instanceof Error ? error.message : "No se pudo exportar el SVG de Síntesis.")
    } finally {
      exportControllerRef.current = null
      exportingSvgRef.current = false
      setExportingSvg(false)
    }
  }

  const cancelExport = () => {
    setCancellingExport(true)
    exportControllerRef.current?.abort()
  }

  if (editorSession) return <main className={styles.editorOnly}>
    <Dialog open={exportingSvg} onOpenChange={(open) => { if (!open) cancelExport() }}>
      <DialogContent showCloseButton={false} className={styles.exportDialog}>
        <DialogHeader>
          <DialogTitle>Exportando apunte</DialogTitle>
          <DialogDescription>Estamos preparando tu archivo para descargarlo.</DialogDescription>
        </DialogHeader>
        <div className={styles.exportStatus} role="status" aria-live="polite">
          <LoaderCircle className={styles.spinner} aria-hidden="true" />
          <span>{cancellingExport ? "Cancelando…" : exportProgress.label}</span>
          <strong>{exportProgress.percent}%</strong>
        </div>
        <progress className={styles.exportProgress} value={exportProgress.percent} max={100} aria-label="Progreso de exportación" />
        <button type="button" className={styles.cancelExport} onClick={cancelExport} disabled={cancellingExport}>
          {cancellingExport ? "Cancelando…" : "Cancelar"}
        </button>
      </DialogContent>
    </Dialog>
    {message ? <div className={styles.notice}>{message}<button onClick={() => setMessage("")} aria-label="Cerrar aviso">×</button></div> : null}
    <SimpleEditor key={editorSession.key} content={editorSession.document} onChange={updateEditorDocument} onError={setMessage}
      toolbarAction={<button type="button" className={styles.exportSvgButton} onClick={() => { void downloadSvg() }} disabled={exportingSvg} aria-busy={exportingSvg} aria-label={exportingSvg ? "Exportando página como SVG…" : "Exportar página como SVG"} title={exportingSvg ? "Exportando página como SVG…" : "Exportar página como SVG"}>{exportingSvg ? <LoaderCircle className={styles.spinner} aria-hidden="true" /> : <Download aria-hidden="true" />}</button>}
      fontSize={workspace.editorFontSize} onFontSizeChange={(editorFontSize) => {
        void acceptWorkspace({ ...workspaceRef.current, editorFontSize }).catch(() => setMessage(SAVE_ERROR_MESSAGE))
      }} />
  </main>

  const currentNodes = childrenOf(nodes, currentParentId)
  const currentNode = currentParentId ? nodes.find((node) => node.id === currentParentId) ?? null : null

  const deleteNode = async (nodeId: string) => {
    const beforeDeletion = structuredClone(workspaceRef.current)
    const next = removeSynthesisNode(workspaceRef.current, nodeId)
    const retainedImages = new Set(referencedLocalImageIds(next.document))
    const removed = referencedLocalImageIds(workspaceRef.current.document).filter((id) => !retainedImages.has(id))
    try {
      await (await getSynthesisFolderStore()).trash(context, beforeDeletion)
      await acceptWorkspace(next)
      void Promise.allSettled(removed.map(deleteSynthesisImage))
    } catch { setMessage("No se pudo guardar la eliminación del nodo.") }
  }

  return <main className={styles.root} style={{ backgroundImage: `linear-gradient(rgba(74,30,14,.2),rgba(74,30,14,.2)), url(${backgroundImage.src})` }}>
    <header className={styles.topbar}>
      <button className={styles.backPlaque} onClick={() => {
        if (currentParentId) setCurrentParentId(currentNode?.parentId ?? null)
        else void goHome()
      }} aria-label={currentNode ? `Volver desde ${currentNode.name}` : "Volver"}><ArrowLeft aria-hidden="true" /></button>
      <label className={styles.weekPicker}>Semana
        <select aria-label="Semana de Síntesis" value={context.weekNumber} onChange={async (event) => {
          const week = event.target.value
          if (!await autosave.flush()) return
          const params = new URLSearchParams({ subjectId: context.subjectId, weekNumber: week })
          const token = sessionStorage.getItem(returnTokenKey)
          if (token) sessionStorage.setItem(buildSynthesisReturnTokenStorageKey({ ...context, weekNumber: Number(week) }), token)
          router.push(`/sintesis?${params}`)
        }}>
          {[...new Set([context.weekNumber, ...savedWeeks])].sort((a, b) => b - a).map((week) => <option key={week} value={week}>{week}</option>)}
        </select>
      </label>
      {currentNode ? <div className={styles.location} title={currentNode.name}><strong>{currentNode.name}</strong></div> : null}
      <button className={styles.trashButton} onClick={async () => {
        try { setTrash(await (await getSynthesisFolderStore()).listTrash()) }
        catch { setMessage("No se pudo abrir la papelera de Síntesis.") }
      }} aria-label="Abrir papelera de Síntesis" title="Papelera"><Trash2 /></button>
      <div className={styles.zoom}>
        <button type="button" disabled={loadState !== "ready"}
          className={speech.status === "listening" || speech.status === "starting" ? styles.micActive : ""}
          onClick={speech.status === "resume" || speech.status === "error" ? speech.retry : speech.toggle}
          aria-label={speech.status === "resume" || speech.status === "error" ? "Reanudar navegación por voz"
            : speech.enabled ? "Desactivar navegación por voz" : "Activar navegación por voz"}
          aria-pressed={speech.status === "listening" || speech.status === "starting"}
          title={speech.status === "resume" || speech.status === "error" ? "Reanudar micrófono"
            : speech.enabled ? "Desactivar micrófono" : "Activar micrófono"}>
          {speech.status === "listening" || speech.status === "starting" ? <Mic aria-hidden="true" /> : <MicOff aria-hidden="true" />}
        </button>
        <button disabled={loadState !== "ready"} onClick={() => openEditor(currentParentId)} aria-label={currentNode ? `Editar ${currentNode.name}` : "Editar la Síntesis completa"} title="Editar"><Pencil /></button>
      </div>
    </header>
    {message ? <div className={styles.notice}>{message}<button onClick={() => setMessage("")} aria-label="Cerrar aviso">×</button></div> : null}
    {trash !== null ? <section className={styles.trashPanel} role="dialog" aria-label="Papelera de Síntesis">
      <h2>Papelera</h2>
      <p>Cada entrada restaura el estado completo previo a un borrado. También se incluyen respaldos anteriores para recuperar borrados recientes.</p>
      <button onClick={() => setTrash(null)}>Cerrar</button>
      {trash.length === 0 ? <p>La papelera está vacía.</p> : trash.map((copy) => <article key={copy.key}>
        <p>{copy.preview || "Contenido sin texto."}</p>
        <button onClick={async () => {
          try {
            await acceptWorkspace(parseStoredSynthesisWorkspace(copy.raw).workspace)
            setTrash(null)
          } catch (error) { setMessage(error instanceof Error ? error.message : "No se pudo restaurar el borrado.") }
        }}>Restaurar este estado</button>
      </article>)}
    </section> : null}
    <Dialog open={topicsOpen} onOpenChange={setTopicsOpen}>
      <DialogContent className={styles.topicsDialog}>
        <DialogHeader>
          <DialogTitle>Temas de Síntesis</DialogTitle>
          <DialogDescription>Elegí un tema para ir a su vista. Para editarlo, decí «abre» o tocá el lápiz.</DialogDescription>
        </DialogHeader>
        {suggestedNodeIds.length ? <div className={styles.topicSuggestions}>
          <strong>Destinos probables</strong>
          {suggestedNodeIds.map((id) => {
            const node = nodes.find((candidate) => candidate.id === id)
            return node ? <button key={id} type="button" onClick={() => navigateToNode(id)}>{voiceNodePath(nodes, id)}</button> : null
          })}
        </div> : null}
        <div className={styles.topicList} role="tree" aria-label="Jerarquía de temas">
          {nodes.length ? nodes.map((node) => <button key={node.id} type="button" role="treeitem" aria-level={node.level}
            className={styles.topicItem} style={{ paddingLeft: `${12 + (node.level - 1) * 20}px` }}
            onClick={() => navigateToNode(node.id)} title={voiceNodePath(nodes, node.id)}>{node.name}</button>)
            : <p>Esta Síntesis todavía no tiene temas.</p>}
        </div>
      </DialogContent>
    </Dialog>
    {loadState !== "ready" ? <div className={styles.emptyState} role="status">
      {loadState === "loading" ? "Cargando la Síntesis guardada…" : "No se pudo cargar la Síntesis guardada."}
      {loadState === "error" ? <button onClick={() => { setLoadState("loading"); setRetry((value) => value + 1) }}>Reintentar</button> : null}
    </div> : nodes.length === 0 ? <div className={styles.emptyState}>No hay contenido cargado para la semana {context.weekNumber}. Podés consultar otra semana desde el selector.</div> : null}
    {loadState === "ready" && currentNode && currentNodes.length === 0 ? <div className={styles.emptyState}>No hay subtemas en «{currentNode.name}». Podés abrir su editor con el lápiz.</div> : null}
    <section className={styles.board} style={{ "--board-height": `${Math.max(1.5, ...currentNodes.map((node) => (workspace.layout[node.id]?.y ?? 0) + 0.3)) * 100}dvh` } as React.CSSProperties} aria-label="Nodos de Síntesis">{currentNodes.map((node) => {
        const position = workspace.layout[node.id] ?? { x: 0.5, y: 0.4, scale: 1 }
        return <div key={node.id} className={styles.nodeWrap} style={{ left: `${position.x * 100}%`, top: `${position.y * 100}dvh`, "--node-scale": position.scale } as React.CSSProperties}>
          <button className={styles.plaque} onPointerDown={(event) => {
            if (event.button !== 0) return
            event.currentTarget.setPointerCapture(event.pointerId)
            setDrag({ id: node.id, startX: event.clientX, startY: event.clientY, originX: position.x, originY: position.y, moved: false })
          }} onPointerMove={(event) => {
            if (!drag || drag.id !== node.id) return
            const dx = event.clientX - drag.startX, dy = event.clientY - drag.startY
            if (!drag.moved && Math.hypot(dx, dy) < 7) return
            const next = normalizeSynthesisWorkspace({ ...workspaceRef.current, layout: { ...workspaceRef.current.layout, [node.id]: { ...position, x: drag.originX + dx / window.innerWidth, y: drag.originY + dy / window.innerHeight } } })
            workspaceRef.current = next; setWorkspace(next); autosave.markDirty(); setDrag({ ...drag, moved: true }); suppressClickRef.current = true
          }} onPointerUp={() => { if (drag?.id === node.id && drag.moved) void acceptWorkspace(workspaceRef.current).catch(() => setMessage(SAVE_ERROR_MESSAGE)); setDrag(null) }} onClick={() => {
            if (suppressClickRef.current) { suppressClickRef.current = false; return }
            setCurrentParentId(node.id)
          }} aria-label={`Abrir ${node.name}`}>{node.name}</button>
          <button className={styles.nodeEdit} onPointerDown={(event) => event.stopPropagation()} onClick={() => openEditor(node.id)} aria-label={`Editar ${node.name}`} title="Editar"><Pencil /></button>
          <button className={`${styles.nodeEdit} ${styles.nodeDelete}`} onPointerDown={(event) => event.stopPropagation()} onClick={() => deleteNode(node.id)} aria-label={`Eliminar ${node.name} de Síntesis`} title="Eliminar de Síntesis"><Trash2 /></button>
        </div>
      })}</section>
  </main>
}
