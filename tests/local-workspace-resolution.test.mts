import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const localWorkspaceSource = readFileSync(
  new URL("../lib/local-workspace-data.ts", import.meta.url),
  "utf8"
)

test("descubre materias personalizadas desde los manifiestos locales", () => {
  assert.match(
    localWorkspaceSource,
    /getDirectoryHandleBySegments\(rootHandle,\s*\[MANIFESTS_DIR,\s*kind\],\s*false\)/
  )
  assert.match(localWorkspaceSource, /if \(handle\.kind !== "directory"\) continue/)
  assert.match(
    localWorkspaceSource,
    /new Set\(\[\.\.\.SUBJECTS\.map\(\(subject\) => subject\.id\),\s*\.\.\.materialSubjectIds,\s*\.\.\.entrySubjectIds\]\)/
  )
})

test("resuelve materiales y entradas usando todas las materias locales conocidas", () => {
  const materialResolverStart = localWorkspaceSource.indexOf("async function findMaterialById")
  const entryResolverStart = localWorkspaceSource.indexOf("async function findEntryById")
  const nextFunctionStart = localWorkspaceSource.indexOf("function getMaterialRelativePath")
  const materialResolver = localWorkspaceSource.slice(materialResolverStart, entryResolverStart)
  const entryResolver = localWorkspaceSource.slice(entryResolverStart, nextFunctionStart)

  assert.ok(materialResolverStart >= 0)
  assert.ok(entryResolverStart > materialResolverStart)
  assert.ok(nextFunctionStart > entryResolverStart)
  assert.match(materialResolver, /const subjectIds = await listKnownLocalSubjectIds\(\)/)
  assert.match(materialResolver, /readMaterialManifest\(subjectId, weekNumber\)/)
  assert.doesNotMatch(materialResolver, /for \(const subject of SUBJECTS\)/)

  assert.match(entryResolver, /const subjectIds = await listKnownLocalSubjectIds\(\)/)
  assert.match(entryResolver, /readEntryManifest\(subjectId, weekNumber\)/)
  assert.doesNotMatch(entryResolver, /for \(const subject of SUBJECTS\)/)
})
