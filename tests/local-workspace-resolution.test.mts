import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const localWorkspaceSource = readFileSync(
  new URL("../lib/local-workspace-data.ts", import.meta.url),
  "utf8"
)
const subjectWheelSource = readFileSync(
  new URL("../components/subject-wheel.tsx", import.meta.url),
  "utf8"
)
const subjectMigrationSource = readFileSync(
  new URL("../lib/local-subject-migration.ts", import.meta.url),
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

test("las lecturas normales no limpian manifiestos y el estado usa catalogo y respaldo", () => {
  const weekListStart = localWorkspaceSource.indexOf("async function listWeekNumbersForManifestKind")
  const synthesisListStart = localWorkspaceSource.indexOf("async function listSynthesisWeekNumbersForSubject")
  const weekList = localWorkspaceSource.slice(weekListStart, synthesisListStart)

  assert.ok(weekListStart >= 0)
  assert.doesNotMatch(weekList, /cleanupLocalSubjectWeekIfEmpty/)
  assert.match(localWorkspaceSource, /subject-catalog\.json/)
  assert.match(localWorkspaceSource, /workspace-state\.backup\.json/)
  assert.match(localWorkspaceSource, /reconstructLocalMaterialManifests\(\)/)
})

test("reconecta carpetas por nombre visible y crea las carpetas que faltan", () => {
  assert.match(localWorkspaceSource, /findCatalogSubjectByDirectoryName\(catalog, sourceId\)/)
  assert.match(localWorkspaceSource, /targetStorageKey: safeName/)
  assert.match(localWorkspaceSource, /copyDirectoryContents\(/)
  assert.match(localWorkspaceSource, /filesHaveSameContent\(/)
  assert.match(subjectMigrationSource, /addFileNameSuffix\(input\.requestedName, suffix\)/)
  assert.match(localWorkspaceSource, /SUBJECT_MIGRATION_MANIFEST/)
  assert.match(localWorkspaceSource, /ensureLocalSubjectDirectories\(Object\.values\(reconciled\.catalog\.subjects\)\)/)
  assert.match(localWorkspaceSource, /\[THEORY_DIR, PRACTICE_DIR, AUDIO_DIR\]/)
  assert.match(localWorkspaceSource, /const resolvedContainerId = material\.container_id/)
})

test("reemplaza Recuperadas por una pestaña comun y borrable", () => {
  assert.match(localWorkspaceSource, /UNASSIGNED_WORKSPACE_TAB_NAME/)
  assert.match(localWorkspaceSource, /delete workspaceTabs\["tab-recovered"\]/)
  assert.doesNotMatch(localWorkspaceSource, /name: "Recuperadas"/)
  assert.doesNotMatch(subjectWheelSource, /RECOVERED_WORKSPACE_TAB_ID/)
  assert.doesNotMatch(subjectWheelSource, /name: "Recuperadas"/)
  assert.match(subjectWheelSource, /\sMover\s/)
  assert.match(subjectWheelSource, /\sBorrar\s/)
  assert.doesNotMatch(subjectWheelSource, /Desvincular/)
})

test("una materia o pestaña puede copiarse a otro destino sin quitar el original", () => {
  const copyStart = subjectWheelSource.indexOf("const copyDeleteTarget")
  const destinationsStart = subjectWheelSource.indexOf("const deleteMoveDestinationTabs")
  const copyAction = subjectWheelSource.slice(copyStart, destinationsStart)

  assert.ok(copyStart >= 0)
  assert.ok(destinationsStart > copyStart)
  assert.match(copyAction, /subjectIds: Array\.from\(new Set\(\[\.\.\.destination\.subjectIds, \.\.\.subjectIds\]\)\)/)
  assert.doesNotMatch(copyAction, /filter\(\(subjectId\) => !subjectIdSet\.has\(subjectId\)\)/)
  assert.match(subjectWheelSource, />\s*Copiar a\s*</)
  assert.match(subjectWheelSource, /onClick=\{\(\) => copyDeleteTarget\(tab\.id\)\}/)
})
