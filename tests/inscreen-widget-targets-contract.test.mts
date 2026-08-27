import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

test("los destinos de widget usan R2 con control de concurrencia y proveedor Bearer", () => {
  const manifest = readFileSync(new URL("../lib/inscreen-widget-targets.ts", import.meta.url), "utf8")
  const publishRoute = readFileSync(new URL("../app/api/inscreen/widget-targets/route.ts", import.meta.url), "utf8")
  const providerRoute = readFileSync(new URL("../app/api/inscreen/provider/widget-targets/route.ts", import.meta.url), "utf8")
  assert.match(manifest, /widget-targets-v1\.json/)
  assert.match(manifest, /ifMatch|ifNoneMatch/)
  assert.match(manifest, /isR2PreconditionFailedError/)
  assert.match(publishRoute, /requireAuthSession/)
  assert.match(publishRoute, /withInscreenUserConfig/)
  assert.match(providerRoute, /authorizeProviderToken/)
  assert.doesNotMatch(providerRoute, /token.*searchParams/i)
})

test("Drive separa fijos, crea shortcuts y publica solo carpetas sincronizadas no fijas", () => {
  const drive = readFileSync(new URL("../lib/google-drive.ts", import.meta.url), "utf8")
  const workspace = readFileSync(new URL("../lib/local-workspace-data.ts", import.meta.url), "utf8")
  assert.match(drive, /application\/vnd\.google-apps\.shortcut/)
  assert.match(drive, /name: "Fijos"/)
  assert.match(workspace, /pathVersion: 2/)
  assert.match(workspace, /status === "synced" && !item\.isPinned/)
  assert.match(workspace, /subjectId: location\.subjectId/)
  assert.match(workspace, /resolveLocalLogicalSubjectId\(item\.subjectId\)/)
  assert.match(workspace, /normalizeLocalWidgetTargetSyncItems/)
  assert.match(workspace, /published\?\.targetSignatures/)
  assert.match(workspace, /getWidgetTargetSignature/)
  assert.match(workspace, /processLocalWidgetTargetSyncQueue/)
})

test("Drive e InScreen trabajan por eventos y el barrido completo queda manual", () => {
  const provider = readFileSync(new URL("../components/local-workspace-provider.tsx", import.meta.url), "utf8")
  const interceptor = readFileSync(new URL("../components/local-fetch-interceptor.tsx", import.meta.url), "utf8")
  const workspace = readFileSync(new URL("../lib/local-workspace-data.ts", import.meta.url), "utf8")
  assert.doesNotMatch(provider, /setInterval\([^)]*processLocal(?:Drive|Widget)SyncQueue/s)
  assert.doesNotMatch(provider.slice(provider.indexOf("const run = async () =>"), provider.indexOf("const reselectWorkspace")), /enqueueAllLocalMaterialsForDrive/)
  assert.match(provider, /await enqueueAllLocalMaterialsForDrive\(\)[\s\S]*await refreshAllLocalMaterialWidgetTargets\(\)/)
  assert.match(interceptor, /hasName \|\| hasPinned[\s\S]*processLocalDriveSyncQueue/)
  assert.match(interceptor, /body\?\.containerId !== undefined \|\| body\?\.materialType !== undefined[\s\S]*processLocalDriveSyncQueue/)
  assert.match(workspace, /entry\.item\.status !== "synced"\)\) continue/)
  assert.match(workspace, /widgetTargetSyncRequested = true[\s\S]*return processLocalWidgetTargetSyncQueue\(\)/)
  assert.match(workspace, /driveSyncRequested = true[\s\S]*return processLocalDriveSyncQueue\(\)/)
})
