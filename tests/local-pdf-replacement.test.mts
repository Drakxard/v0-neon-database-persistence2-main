import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import ts from "typescript"

// Execute the real local operation with a failing filesystem, without opening a user's workspace.
const source = readFileSync(new URL("../lib/local-workspace-data.ts", import.meta.url), "utf8")
const operation = source.slice(source.indexOf("export async function syncLocalMaterialPdf("), source.indexOf("export async function syncLocalCronogramaPdf("))
const javascript = ts.transpileModule(operation.replace("export async", "async"), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText

for (const failure of [null, "file", "manifest", "tags", "queue"]) {
  test(`reemplazo local ${failure ? `restaura el PDF al fallar ${failure}` : "conserva identidad y actualiza el archivo"}`, async () => {
    const oldMaterial = { id: 7, subject_id: "algebra", week_number: 1, drive_file_id: "local:old.pdf", file_name: "old.pdf" }
    const originalTags = { regions: { "7:1": [{ page: 1 }], "8:1": [{ page: 2 }] } }
    let bytes = new Blob(["%PDF-original"])
    let materials = [oldMaterial]
    let tags = structuredClone(originalTags)
    let failed = false
    const fail = (step: string) => { if (failure === step && !failed) { failed = true; throw new Error(`failure: ${step}`) } }
    const dependencies = {
      findMaterialById: async () => oldMaterial,
      normalizePdfFileName: (name: string) => name,
      getWorkspaceFile: async () => bytes,
      readMaterialManifest: async () => ({ materials: structuredClone(materials) }),
      readTagManifest: async () => structuredClone(tags),
      nowIso: () => "2026-09-04T00:00:00.000Z",
      persistWorkspaceBlob: async (_id: string, file: Blob) => { fail("file"); bytes = file },
      writeMaterialManifest: async (_subject: string, _week: number, value: typeof materials) => { fail("manifest"); materials = value },
      writeTagManifest: async (value: typeof tags) => { fail("tags"); tags = value },
      enqueueLocalMaterialDriveUpload: async () => { fail("queue") },
    }
    const sync = new Function(...Object.keys(dependencies), `${javascript}\nreturn syncLocalMaterialPdf`)(...Object.values(dependencies))
    const form = new FormData()
    form.set("file", new File(["%PDF-replacement"], "new.pdf", { type: "application/pdf" }))
    form.set("fileName", "new.pdf")
    if (failure) {
      await assert.rejects(sync(7, form), /failure:/)
      assert.equal(await bytes.text(), "%PDF-original")
      assert.deepEqual(materials, [oldMaterial])
      assert.deepEqual(tags, originalTags)
    } else {
      const result = await sync(7, form)
      assert.equal(result.id, 7)
      assert.equal(result.drive_file_id, oldMaterial.drive_file_id)
      assert.equal(result.file_name, "new.pdf")
      assert.equal(await bytes.text(), "%PDF-replacement")
      assert.deepEqual(tags.regions, { "8:1": [{ page: 2 }] })
    }
  })
}
