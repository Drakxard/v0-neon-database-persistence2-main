import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8")
}

test("la migracion conserva materiales y hace idempotentes las asignaciones", () => {
  const migration = source("scripts/029-create-material-tags.sql")
  assert.match(migration, /REFERENCES subject_day_materials\(id\) ON DELETE CASCADE/)
  assert.match(migration, /PRIMARY KEY \(material_id, tag_id\)/)
  assert.doesNotMatch(migration, /(?:UPDATE|DELETE FROM) subject_day_materials/i)
})

test("el modo local cubre catalogo, asignacion y consulta por material", () => {
  const interceptor = source("components/local-fetch-interceptor.tsx")
  assert.match(interceptor, /listLocalMaterialTagWorkspace/)
  assert.match(interceptor, /assignLocalTagToMaterial/)
  assert.match(interceptor, /unassignLocalTagFromMaterial/)
  assert.match(interceptor, /listLocalTagsForMaterial/)
})

test("la lista de materiales permite filtrar y asignar arrastrando el tag al PDF", () => {
  const subjectWheel = source("components/subject-wheel.tsx")
  const tagBar = source("components/material-tag-bar.tsx")
  assert.match(subjectWheel, /materialMatchesTagFilter/)
  assert.match(subjectWheel, /getData\("application\/x-study-tag-id"\)/)
  assert.match(tagBar, /setData\("application\/x-study-tag-id"/)
  assert.doesNotMatch(subjectWheel, /setData\("application\/x-study-material-id"/)
  assert.match(subjectWheel, /<MaterialTagBar controller=\{materialTags\}/)
})

test("la barra de tags captura escritura sin mover el scroll y filtra los chips en la misma fila", () => {
  const tagBar = source("components/material-tag-bar.tsx")
  const subjectWheel = source("components/subject-wheel.tsx")
  assert.match(tagBar, /event\.key\.length !== 1/)
  assert.match(tagBar, /focus\(\{ preventScroll: true \}\)/)
  assert.match(tagBar, /setInput\(event\.key\)/)
  assert.match(tagBar, /visibleTags\.map/)
  assert.match(tagBar, /document\.addEventListener\("scroll", onScroll, \{ capture: true, passive: true \}\)/)
  assert.match(tagBar, /isFloating \? "fixed left-3 right-3 top-3 z-\[90\]/)
  assert.match(tagBar, /: "hidden"/)
  assert.match(tagBar, /setIsFloating\(false\)/)
  assert.match(subjectWheel, /<MaterialTagBar controller=\{materialTags\} \/>/)
  assert.doesNotMatch(tagBar, /top-full z-50/)
})

test("el visor usa la envoltura React y no modifica internamente PDF.js para mostrar tags", () => {
  const subjectWheel = source("components/subject-wheel.tsx")
  const viewer = source("app/practice/viewer/practice-viewer-client.tsx")
  assert.match(subjectWheel, /\/practice\/viewer\?/)
  assert.match(viewer, /<MaterialTagPicker/)
  assert.doesNotMatch(source("public/pdfjs/web/viewer-custom.js"), /MaterialTagPicker|\/api\/tags/)
})

test("el visor local valida una sola fuente y el remoto versiona su cache", () => {
  const viewer = source("app/practice/viewer/practice-viewer-client.tsx")
  const cache = source("app/practice/viewer/pdf-memory-cache.ts")
  const pdfJs = source("public/pdfjs/web/viewer-custom.js")
  assert.match(viewer, /validateWorkspaceMaterialIdentity/)
  assert.match(viewer, /getWorkspaceFile\(resolvedMaterial\.workspaceFileId!\)/)
  assert.match(viewer, /localWorkspaceMode\s*\?\s*""/)
  assert.match(viewer, /key=\{viewerIdentity\}/)
  assert.match(cache, /buildPracticePdfCacheKey/)
  assert.match(cache, /cache: "no-store"/)
  assert.match(pdfJs, /fingerprint: state\.app\?\.pdfDocument\?\.fingerprints/)
})
