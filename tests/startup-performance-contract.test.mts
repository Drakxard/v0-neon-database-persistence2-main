import assert from "node:assert/strict"
import { existsSync, readFileSync } from "node:fs"
import test from "node:test"

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8")
}

test("la ruta inicial carga la rueda sin una vista previa transitoria", () => {
  const page = source("app/page.tsx")
  const loader = source("components/subject-wheel-loader.tsx")
  const provider = source("components/local-workspace-provider.tsx")

  assert.match(page, /SubjectWheelLoader/)
  assert.doesNotMatch(page, /from "@\/components\/subject-wheel"/)
  assert.match(loader, /dynamic\(/)
  assert.match(loader, /ssr: false/)
  assert.doesNotMatch(loader, /WorkspaceStartupScreen/)
  assert.doesNotMatch(provider, /WorkspaceStartupScreen/)
  assert.equal(existsSync(new URL("../app/loading.tsx", import.meta.url)), false)
  assert.equal(existsSync(new URL("../components/workspace-startup-screen.tsx", import.meta.url)), false)
})

test("la rueda real usa la última pestaña como cache descartable mientras llega el manifiesto", () => {
  const wheel = source("components/subject-wheel.tsx")
  const saveStart = wheel.indexOf("function saveWorkspaceTabsState")
  const saveEnd = wheel.indexOf("function hasWorkspaceTabsStateContent")
  const saveFunction = wheel.slice(saveStart, saveEnd)

  assert.match(wheel, /\(\) => loadWorkspaceTabsState\(\)/)
  assert.doesNotMatch(saveFunction, /if \(LOCAL_STORAGE_MODE\) return/)
  assert.match(wheel, /hasCachedWorkspaceStateRef/)
  assert.match(wheel, /isRefreshingCachedHome/)
  assert.match(wheel, /Actualizando datos locales/)
})

test("el visor local usa una URL compacta y resuelve el contexto por materialId", () => {
  const wheel = source("components/subject-wheel.tsx")
  const page = source("app/practice/viewer/page.tsx")
  const viewer = source("app/practice/viewer/practice-viewer-client.tsx")
  const provider = source("components/local-workspace-provider.tsx")
  const pdfJs = source("public/pdfjs/web/viewer-custom.js")

  assert.match(wheel, /function appendMaterialViewerParams/)
  assert.match(wheel, /params\.set\("materialId", String\(material\.id\)\)/)
  assert.doesNotMatch(wheel, /params\.set\("workspaceFileId", material\.drive_file_id\)/)
  assert.match(wheel, /appendMaterialViewerParams\(params, material\)[\s\S]*presentationTagIds/)
  assert.match(page, /materialId=\{hasImmediateLocalMaterialContext \? undefined : materialId\}/)
  assert.match(viewer, /bg-\[#d4d4d7\]/)
  assert.match(viewer, /if \(!isLocalMode \|\| !rootHandle\) return/)
  assert.match(viewer, /getLocalMaterialById\(resolvedMaterialId\)/)
  assert.match(viewer, /!Number\.isInteger\(materialId\) \|\| !rootHandle/)
  assert.match(viewer, /\[isLocalMode, material, materialId, rootHandle, subjectActivationDate, subjectTargetWeekday\]/)
  assert.match(provider, /pathname === "\/practice\/viewer"/)
  assert.match(provider, /isReady \|\| canRenderBeforeWorkspaceReady/)
  assert.match(pdfJs, /isOpeningLocalWorkspaceDocument/)
  assert.match(pdfJs, /Custom PDF\.js local workspace retry failed/)
})

test("el bootstrap rápido queda separado de la reconciliación en segundo plano", () => {
  const data = source("lib/local-workspace-data.ts")
  const wheel = source("components/subject-wheel.tsx")
  const bootstrapStart = data.indexOf("export async function readLocalWorkspaceTabsState")
  const reconcileStart = data.indexOf("export async function reconcileLocalWorkspaceTabsState")
  const bootstrap = data.slice(bootstrapStart, reconcileStart)
  const reconciliation = data.slice(reconcileStart)

  assert.ok(bootstrapStart >= 0)
  assert.ok(reconcileStart > bootstrapStart)
  assert.doesNotMatch(bootstrap, /reconstructLocalMaterialManifests/)
  assert.doesNotMatch(bootstrap, /discoverLocalSubjectSourceIds/)
  assert.match(reconciliation, /reconstructLocalMaterialManifests\(\)/)
  assert.match(reconciliation, /latestLoaded/)
  assert.match(wheel, /window\.requestIdleCallback\(runReconciliation/)
  assert.match(wheel, /window\.setTimeout\(runReconciliation, 50\)/)
  assert.match(wheel, /reconcileLocalWorkspaceTabsState\(\)/)
})

test("el handle y las migraciones evitan trabajo repetido", () => {
  const client = source("lib/local-workspace-client.ts")
  const data = source("lib/local-workspace-data.ts")

  assert.match(client, /readyWorkspaceHandle/)
  assert.match(client, /if \(cachedWorkspaceHandle\) return cachedWorkspaceHandle/)
  assert.match(client, /await Promise\.all\(/)
  assert.match(data, /completedPlanSignatures/)
  assert.match(data, /availableSources\.has\(sourceId\)/)
  assert.doesNotMatch(data, /deleteJsonFile\(SUBJECT_MIGRATION_MANIFEST\)/)
  assert.match(data, /const latestManifest = await readMaterialManifest/)
})
