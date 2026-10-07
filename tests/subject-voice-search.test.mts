import assert from "node:assert/strict"
import test from "node:test"
import { searchVoiceImages, voiceGroupDiameter, voiceImageName } from "../lib/subject-voice-search.ts"

const groups = [{ id: "conceptos", name: "Conceptos", color: "#b2f2bb", images: [
  { id: "a", name: "Teo existencia orden 1.png", path: "a" },
  { id: "b", name: "Definición ED.webp", path: "b" },
  { id: "c", name: "Teoría de conjuntos.png", path: "c" },
] }, { id: "modelos", name: "Modelos", color: "#a5d8ff", images: [
  { id: "d", name: "Modelo lineal.png", path: "d" },
  { id: "e", name: "Modelo mezclas.png", path: "e" },
  { id: "f", name: "Teorema existencia orden N.png", path: "f" },
] }]
const found = (query: string) => searchVoiceImages(groups, query).map(({ image }) => image.id)

test("busca fragmentos, acentos, plural y abreviaturas en toda la materia", () => {
  assert.deepEqual(found("MODELOS"), ["d", "e"])
  assert.deepEqual(found("definiciones"), ["b"])
  assert.deepEqual(found("teoremas"), ["a", "f"])
  assert.deepEqual(found("teo"), ["a", "f"])
  assert.deepEqual(found("mezcl"), ["e"])
  assert.deepEqual(found("teorema existencia 1"), ["a"])
  assert.deepEqual(found("teorema mezclas"), [])
  assert.deepEqual(found("  "), [])
  assert.deepEqual(found("png"), [])
  assert.equal(searchVoiceImages(groups, "modelo")[0].image, groups[1].images[0])
})

test("nombres sin última extensión y diámetro acotado según cantidad", () => {
  assert.equal(voiceImageName("Teorema.orden.png"), "Teorema.orden")
  assert.equal(voiceImageName("Modelo"), "Modelo")
  assert.equal(voiceGroupDiameter(0), 160)
  assert.equal(voiceGroupDiameter(4), 200)
  assert.equal(voiceGroupDiameter(1000), 320)
  assert.equal(voiceGroupDiameter(22) > voiceGroupDiameter(4), true)
})
