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

test("la barra de tags captura escritura global fuera de otros campos", () => {
  const tagBar = source("components/material-tag-bar.tsx")
  assert.match(tagBar, /event\.key\.length !== 1/)
  assert.match(tagBar, /inputRef\.current\?\.focus\(\)/)
  assert.match(tagBar, /setInput\(event\.key\)/)
})

test("el visor usa la envoltura React y no modifica internamente PDF.js para mostrar tags", () => {
  const subjectWheel = source("components/subject-wheel.tsx")
  const viewer = source("app/practice/viewer/practice-viewer-client.tsx")
  assert.match(subjectWheel, /\/practice\/viewer\?/)
  assert.match(viewer, /<MaterialTagPicker/)
  assert.doesNotMatch(source("public/pdfjs/web/viewer-custom.js"), /MaterialTagPicker|\/api\/tags/)
})
