import assert from "node:assert/strict"
import test from "node:test"

import {
  addFileNameSuffix,
  chooseNonOverwritingFileName,
} from "../lib/local-subject-migration.ts"

function bytes(value: string) {
  return new TextEncoder().encode(value)
}

async function sameBytes(left: Uint8Array, right: Uint8Array) {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

test("agrega el sufijo antes de la extension", () => {
  assert.equal(addFileNameSuffix("guia.pdf", 2), "guia (2).pdf")
  assert.equal(addFileNameSuffix("audio", 3), "audio (3)")
})

test("un sistema de archivos simulado conserva homonimos sin duplicar un reintento", async () => {
  const files = new Map<string, Uint8Array>([
    ["guia.pdf", bytes("destino")],
    ["guia (2).pdf", bytes("origen")],
  ])
  const retried = await chooseNonOverwritingFileName({
    requestedName: "guia.pdf",
    source: bytes("origen"),
    readExisting: async (name) => files.get(name) ?? null,
    hasSameContent: sameBytes,
  })
  assert.deepEqual(retried, { name: "guia (2).pdf", alreadyCopied: true })

  files.set("guia (2).pdf", bytes("otro"))
  const conflict = await chooseNonOverwritingFileName({
    requestedName: "guia.pdf",
    source: bytes("origen"),
    readExisting: async (name) => files.get(name) ?? null,
    hasSameContent: sameBytes,
  })
  assert.deepEqual(conflict, { name: "guia (3).pdf", alreadyCopied: false })
})
