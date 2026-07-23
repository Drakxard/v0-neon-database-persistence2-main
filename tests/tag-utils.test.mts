import assert from "node:assert/strict"
import test from "node:test"

import {
  materialMatchesTagFilter,
  matchesTagSearch,
  normalizeTagName,
  wouldCreateTagCycle,
} from "../lib/tag-utils.ts"

test("normaliza espacios, Unicode y mayusculas sin quitar acentos", () => {
  assert.equal(normalizeTagName("  ÁLGEBRA   Lineal  "), "álgebra lineal")
  assert.notEqual(normalizeTagName("limite"), normalizeTagName("límite"))
})

test("la busqueda predictiva ignora acentos", () => {
  assert.equal(matchesTagSearch("Álgebra Lineal", "#algebra"), true)
  assert.equal(matchesTagSearch("Espacios vectoriales", "matrices"), false)
})

test("los filtros AND y OR son deterministas", () => {
  assert.equal(materialMatchesTagFilter([1, 2], [1, 2], "and"), true)
  assert.equal(materialMatchesTagFilter([1], [1, 2], "and"), false)
  assert.equal(materialMatchesTagFilter([1], [1, 2], "or"), true)
  assert.equal(materialMatchesTagFilter([], [], "and"), true)
})

test("detecta ciclos directos y transitivos en la jerarquia", () => {
  const parents = new Map<number, number | null>([
    [1, null],
    [2, 1],
    [3, 2],
  ])
  assert.equal(wouldCreateTagCycle(1, 1, parents), true)
  assert.equal(wouldCreateTagCycle(1, 3, parents), true)
  assert.equal(wouldCreateTagCycle(3, 1, parents), false)
  assert.equal(wouldCreateTagCycle(2, null, parents), false)
})
