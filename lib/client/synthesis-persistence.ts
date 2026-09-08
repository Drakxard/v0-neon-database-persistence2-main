import { getReadyWorkspaceHandle } from "../local-workspace-client.ts"
import { createSynthesisFolderStore, type SynthesisFolderStore } from "./synthesis-folder-store.ts"

const stores = new WeakMap<FileSystemDirectoryHandle, SynthesisFolderStore>()
const migrations = new WeakMap<FileSystemDirectoryHandle, Promise<void>>()

export async function getSynthesisFolderStore(): Promise<SynthesisFolderStore> {
  const root = getReadyWorkspaceHandle()
  if (!root) throw new Error("Síntesis necesita acceso a la carpeta local del dispositivo.")
  let store = stores.get(root)
  if (!store) { store = createSynthesisFolderStore(root); stores.set(root, store) }
  let migration = migrations.get(root)
  if (!migration) {
    const target = store
    migration = (async () => {
      await target.migrate(localStorage)
      const { migrateSynthesisImagesToFolder } = await import("./synthesis-images.ts")
      await migrateSynthesisImagesToFolder(target)
    })().catch((error) => { migrations.delete(root); throw error })
    migrations.set(root, migration)
  }
  await migration
  if (getReadyWorkspaceHandle() !== root) throw new Error("La carpeta local cambió mientras se cargaba Síntesis.")
  return store
}
