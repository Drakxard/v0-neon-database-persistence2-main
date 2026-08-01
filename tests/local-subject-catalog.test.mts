import assert from "node:assert/strict"
import test from "node:test"

import {
  allocateLocalSubjectStorageKey,
  createEmptyLocalSubjectCatalog,
  createLocalSubjectDirectoryName,
  createLocalSubjectStorageKey,
  findCatalogSubjectByDirectoryName,
  findCatalogSubjectByName,
  getLegacyLocalSubjectSources,
  normalizeLocalSubjectCatalog,
  normalizeLocalSubjectName,
  type LegacyLocalSubjectCatalog,
  type LocalSubjectCatalog,
} from "../lib/local-subject-catalog.ts"

test("normaliza el nombre de materia sin depender de acentos, espacios o mayusculas", () => {
  assert.equal(normalizeLocalSubjectName("  ÁLGEBRA   2 "), "algebra 2")
  assert.equal(createLocalSubjectStorageKey("  Laboratorio 1 "), "laboratorio-1")
})

test("conserva el nombre visible como carpeta y reemplaza caracteres no validos", () => {
  assert.equal(createLocalSubjectDirectoryName("  Lab   1  "), "Lab 1")
  assert.equal(createLocalSubjectDirectoryName("Fisica: teoria/practica"), "Fisica- teoria-practica")
  assert.equal(createLocalSubjectDirectoryName("CON"), "CON-")
})

test("catalogo v2 mantiene una sola carpeta canonica por materia", () => {
  const timestamp = "2026-07-31T00:00:00.000Z"
  const catalog: LocalSubjectCatalog = {
    version: 2,
    subjects: {
      "lab-1": {
        id: "lab-1",
        name: "Lab 1",
        normalizedName: "lab 1",
        storageKey: "Lab 1",
        createdAt: timestamp,
        updatedAt: timestamp,
      },
    },
  }
  assert.equal(findCatalogSubjectByName(catalog, "LÁB  1")?.id, "lab-1")
  assert.equal(findCatalogSubjectByDirectoryName(catalog, "LÁB-1")?.id, "lab-1")
  assert.equal(allocateLocalSubjectStorageKey(catalog, "Lab 1"), "lab-1-2")
  assert.equal(allocateLocalSubjectStorageKey(createEmptyLocalSubjectCatalog(), "Lab 1"), "lab-1")
})

test("migra catalogo v1 sin persistir aliases ni estado recuperado", () => {
  const timestamp = "2026-07-31T00:00:00.000Z"
  const legacy: LegacyLocalSubjectCatalog = {
    version: 1,
    subjects: {
      lab: {
        id: "lab",
        name: "Lab 1",
        normalizedName: "lab 1",
        storageKey: "custom-123",
        sourceIds: ["custom-123", "Lab 1"],
        createdAt: timestamp,
        updatedAt: timestamp,
        recovered: true,
      },
    },
  }
  assert.deepEqual(getLegacyLocalSubjectSources(legacy).lab, ["lab", "custom-123", "Lab 1"])
  const migrated = normalizeLocalSubjectCatalog(legacy)
  assert.equal(migrated.version, 2)
  assert.deepEqual(migrated.subjects.lab, {
    id: "lab",
    name: "Lab 1",
    normalizedName: "lab 1",
    storageKey: "custom-123",
    createdAt: timestamp,
    updatedAt: timestamp,
  })
  assert.equal("sourceIds" in migrated.subjects.lab, false)
  assert.equal("recovered" in migrated.subjects.lab, false)
})
