import { buildSynthesisLocalStorageKey, type SynthesisContext } from "../synthesis-context.ts"
import { SYNTHESIS_WORKSPACE_STORAGE_KEY, SYNTHESIS_WORKSPACE_PENDING_KEY, normalizeSynthesisWorkspace, type SynthesisWorkspaceV2 } from "../synthesis-workspace.ts"

export const SYNTHESIS_MATERIALS_CHANGED_EVENT = "synthesis-materials-changed"

export function readMaterialSynthesis(context: SynthesisContext): SynthesisWorkspaceV2 | null {
  const raw = localStorage.getItem(buildSynthesisLocalStorageKey(SYNTHESIS_WORKSPACE_PENDING_KEY, context))
    ?? localStorage.getItem(buildSynthesisLocalStorageKey(SYNTHESIS_WORKSPACE_STORAGE_KEY, context))
  if (!raw) return null
  // A corrupt cache must stop a destructive action, rather than look like an empty development.
  const parsed = JSON.parse(raw)
  return normalizeSynthesisWorkspace(parsed.workspace ?? parsed)
}

export function writeMaterialSynthesis(context: SynthesisContext, workspace: SynthesisWorkspaceV2) {
  localStorage.setItem(buildSynthesisLocalStorageKey(SYNTHESIS_WORKSPACE_STORAGE_KEY, context), JSON.stringify(workspace))
  localStorage.removeItem(buildSynthesisLocalStorageKey(SYNTHESIS_WORKSPACE_PENDING_KEY, context))
  window.dispatchEvent(new Event(SYNTHESIS_MATERIALS_CHANGED_EVENT))
}
