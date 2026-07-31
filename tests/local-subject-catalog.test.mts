import assert from "node:assert/strict"
import test from "node:test"

import {
  allocateLocalSubjectStorageKey,
  createEmptyLocalSubjectCatalog,
  createLocalSubjectStorageKey,
  findCatalogSubjectByName,
  mergeCatalogSubjects,
  normalizeLocalSubjectName,
  type LocalSubjectCatalog,
} from "../lib/local-subject-catalog.ts"

test("normaliza el nombre de materia sin depender de acentos, espacios o mayusculas", () => {
  assert.equal(normalizeLocalSubjectName("  ÁLGEBRA   2 "), "algebra 2")
  assert.equal(createLocalSubjectStorageKey("  Laboratorio 1 "), "laboratorio-1")
})

test("reutiliza nombres equivalentes y asigna sufijos solo a colisiones distintas", () => {
  const timestamp = "2026-07-31T00:00:00.000Z"
  const catalog: LocalSubjectCatalog = {
    version: 1,
    subjects: {
      "lab-1": {
        id: "lab-1",
        name: "Lab 1",
        normalizedName: "lab 1",
        storageKey: "lab-1",
        sourceIds: ["lab-1"],
        createdAt: timestamp,
        updatedAt: timestamp,
        recovered: false,
      },
    },
  }
  assert.equal(findCatalogSubjectByName(catalog, "LÁB  1")?.id, "lab-1")
  assert.equal(allocateLocalSubjectStorageKey(catalog, "Lab 1"), "lab-1-2")
  assert.equal(allocateLocalSubjectStorageKey(createEmptyLocalSubjectCatalog(), "Lab 1"), "lab-1")
})

test("une fuentes antiguas de forma idempotente sin mover archivos", () => {
  const timestamp = "2026-07-31T00:00:00.000Z"
  const catalog: LocalSubjectCatalog = {
    version: 1,
    subjects: {
      algebra: {
        id: "algebra",
        name: "Algebra 2",
        normalizedName: "algebra 2",
        storageKey: "algebra",
        sourceIds: ["algebra"],
        createdAt: timestamp,
        updatedAt: timestamp,
        recovered: false,
      },
      legacy: {
        id: "legacy",
        name: "Recuperada",
        normalizedName: "recuperada",
        storageKey: "legacy",
        sourceIds: ["legacy"],
        createdAt: timestamp,
        updatedAt: timestamp,
        recovered: true,
      },
    },
  }
  const merged = mergeCatalogSubjects(catalog, "algebra", ["legacy"])
  assert.deepEqual(merged.subjects.algebra.sourceIds, ["algebra", "legacy"])
  assert.equal(merged.subjects.legacy, undefined)
  assert.deepEqual(mergeCatalogSubjects(merged, "algebra", ["legacy"]), merged)
})
