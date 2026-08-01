import assert from "node:assert/strict"
import test from "node:test"

import { validateWorkspaceMaterialIdentity } from "../lib/workspace-material-identity.ts"

const baseMaterial = {
  id: 178561805337014,
  subjectId: "Lab 1",
  sessionDate: "2026-08-01",
  weekNumber: 20,
}

test("acepta la carpeta canónica de una materia en práctica y teoría", () => {
  assert.equal(
    validateWorkspaceMaterialIdentity({
      ...baseMaterial,
      materialType: "practice",
      workspaceFileId: "workspace://practica/Lab 1/week-20/2026-08-01/archivo.pdf",
    }),
    ""
  )
  assert.equal(
    validateWorkspaceMaterialIdentity({
      ...baseMaterial,
      subjectId: "Álgebra: 2/Avanzada",
      materialType: "theory",
      workspaceFileId: "workspace://teoria/Álgebra- 2-Avanzada/week-20/2026-08-01/teoria.pdf",
    }),
    ""
  )
})

test("rechaza una ruta con tipo, materia, semana, fecha o archivo incorrectos", () => {
  const invalidWorkspaceFileIds = [
    "workspace://teoria/Lab 1/week-20/2026-08-01/archivo.pdf",
    "workspace://practica/lab-1/week-20/2026-08-01/archivo.pdf",
    "workspace://practica/Lab 1/week-19/2026-08-01/archivo.pdf",
    "workspace://practica/Lab 1/week-20/2026-07-31/archivo.pdf",
    "workspace://practica/Lab 1/week-20/2026-08-01",
  ]

  for (const workspaceFileId of invalidWorkspaceFileIds) {
    assert.match(
      validateWorkspaceMaterialIdentity({
        ...baseMaterial,
        materialType: "practice",
        workspaceFileId,
      }),
      /La ruta local del material/
    )
  }
})

test("rechaza identificadores que no pertenecen al workspace local", () => {
  assert.match(
    validateWorkspaceMaterialIdentity({
      ...baseMaterial,
      materialType: "practice",
      workspaceFileId: "https://example.com/archivo.pdf",
    }),
    /no tiene un identificador de archivo local válido/
  )
})
