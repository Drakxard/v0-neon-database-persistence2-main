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

test("la lista de materiales permite filtrar y asignar por arrastre", () => {
  const subjectWheel = source("components/subject-wheel.tsx")
  assert.match(subjectWheel, /materialMatchesTagFilter/)
  assert.match(subjectWheel, /application\/x-study-material-id/)
  assert.match(subjectWheel, /<MaterialTagBar controller=\{materialTags\}/)
})

test("el visor usa la envoltura React y no modifica internamente PDF.js para mostrar tags", () => {
  const subjectWheel = source("components/subject-wheel.tsx")
  const viewer = source("app/practice/viewer/practice-viewer-client.tsx")
  assert.match(subjectWheel, /\/practice\/viewer\?/)
  assert.match(viewer, /<MaterialTagPicker/)
  assert.doesNotMatch(source("public/pdfjs/web/viewer-custom.js"), /MaterialTagPicker|\/api\/tags/)
})
