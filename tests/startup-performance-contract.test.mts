import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8")
}

test("la ruta inicial usa un loader liviano y nunca deja el workspace en blanco", () => {
  const page = source("app/page.tsx")
  const routeLoading = source("app/loading.tsx")
  const loader = source("components/subject-wheel-loader.tsx")
  const provider = source("components/local-workspace-provider.tsx")

  assert.match(page, /SubjectWheelLoader/)
  assert.doesNotMatch(page, /from "@\/components\/subject-wheel"/)
  assert.match(loader, /dynamic\(/)
  assert.match(loader, /ssr: false/)
  assert.match(loader, /WorkspaceStartupScreen/)
  assert.match(provider, /enabled && !isReady \? <WorkspaceStartupScreen \/>/)
  assert.match(routeLoading, /WorkspaceStartupScreen/)
})

test("la última pestaña se usa como cache descartable mientras llega el manifiesto", () => {
  const wheel = source("components/subject-wheel.tsx")
  const startup = source("components/workspace-startup-screen.tsx")
  const saveStart = wheel.indexOf("function saveWorkspaceTabsState")
  const saveEnd = wheel.indexOf("function hasWorkspaceTabsStateContent")
  const saveFunction = wheel.slice(saveStart, saveEnd)

  assert.match(wheel, /\(\) => loadWorkspaceTabsState\(\)/)
  assert.doesNotMatch(saveFunction, /if \(LOCAL_STORAGE_MODE\) return/)
  assert.match(wheel, /hasCachedWorkspaceStateRef/)
  assert.match(wheel, /pointer-events-none/)
  assert.match(startup, /subject-wheel:workspace-tabs:v1/)
  assert.match(startup, /activeWorkspaceTabId/)
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
