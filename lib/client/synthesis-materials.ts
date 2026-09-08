import { type SynthesisContext } from "../synthesis-context.ts"
import { syncSynthesis } from "./synthesis-sync.ts"
import { getSynthesisFolderStore } from "./synthesis-persistence.ts"
import { normalizeSynthesisWorkspace, type SynthesisWorkspaceV2 } from "../synthesis-workspace.ts"

export const SYNTHESIS_MATERIALS_CHANGED_EVENT = "synthesis-materials-changed"

export async function readMaterialSynthesis(context: SynthesisContext): Promise<SynthesisWorkspaceV2 | null> {
  const record = await (await getSynthesisFolderStore()).read(context)
  return record ? normalizeSynthesisWorkspace(record.workspace) : null
}

export async function writeMaterialSynthesis(context: SynthesisContext, workspace: SynthesisWorkspaceV2) {
  await (await getSynthesisFolderStore()).save(context, workspace)
  window.dispatchEvent(new CustomEvent(SYNTHESIS_MATERIALS_CHANGED_EVENT, { detail: context }))
  void syncSynthesis(context)
}
