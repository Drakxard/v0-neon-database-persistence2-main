import assert from "node:assert/strict"
import test from "node:test"

import { DRIVE_UPLOAD_CHUNK_SIZE, uploadPdfDirectlyToDrive } from "../lib/google-drive-upload-client.ts"

const item = {
  materialId: 42,
  fileName: "apunte.pdf",
  subjectName: "Calculo",
  weekNumber: 3,
  containerName: "Teoria",
}

function contextResponse(token = "token-temporal") {
  return Response.json({
    accessToken: token,
    expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    parentFolderId: "folder-1",
    appProperties: { cursadoMaterialId: "42", cursadoContentSha256: "hash" },
  })
}

test("inicia y completa una subida directa pequena", async () => {
  const originalFetch = globalThis.fetch
  const calls: Array<{ url: string; init?: RequestInit }> = []
  const responses = [
    contextResponse(),
    new Response(null, { status: 200, headers: { Location: "https://upload.example/session-1" } }),
    Response.json({ id: "drive-file-1", webViewLink: "https://drive.example/file-1" }),
  ]
  globalThis.fetch = async (input, init) => {
    calls.push({ url: String(input), init })
    return responses.shift()!
  }
  try {
    const uploaded = await uploadPdfDirectlyToDrive(item, new Blob(["pdf"], { type: "application/pdf" }))
    assert.equal(uploaded.id, "drive-file-1")
    assert.equal(calls[0].url, "/api/google/drive/upload-session")
    assert.match(String(calls[1].url), /googleapis\.com\/upload\/drive\/v3\/files/)
    assert.equal(new Headers(calls[1].init?.headers).get("Authorization"), "Bearer token-temporal")
    assert.equal(new Headers(calls[2].init?.headers).get("Content-Range"), "bytes 0-2/3")
    assert.equal(responses.length, 0)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test("continua los fragmentos cuando Google responde 308", async () => {
  const originalFetch = globalThis.fetch
  const ranges: string[] = []
  let call = 0
  globalThis.fetch = async (_input, init) => {
    call += 1
    if (call === 1) return contextResponse()
    if (call === 2) return new Response(null, { status: 200, headers: { Location: "https://upload.example/session-2" } })
    ranges.push(new Headers(init?.headers).get("Content-Range") || "")
    if (call === 3) return new Response(null, { status: 308, headers: { Range: `bytes=0-${DRIVE_UPLOAD_CHUNK_SIZE - 1}` } })
    return Response.json({ id: "drive-file-2" })
  }
  try {
    const file = new Blob([new Uint8Array(DRIVE_UPLOAD_CHUNK_SIZE + 1)], { type: "application/pdf" })
    assert.equal((await uploadPdfDirectlyToDrive(item, file)).id, "drive-file-2")
    assert.deepEqual(ranges, [
      `bytes 0-${DRIVE_UPLOAD_CHUNK_SIZE - 1}/${DRIVE_UPLOAD_CHUNK_SIZE + 1}`,
      `bytes ${DRIVE_UPLOAD_CHUNK_SIZE}-${DRIVE_UPLOAD_CHUNK_SIZE}/${DRIVE_UPLOAD_CHUNK_SIZE + 1}`,
    ])
  } finally {
    globalThis.fetch = originalFetch
  }
})

test("renueva el contexto una vez si el token temporal vence", async () => {
  const originalFetch = globalThis.fetch
  let call = 0
  globalThis.fetch = async () => {
    call += 1
    if (call === 1) return contextResponse("token-vencido")
    if (call === 2) return new Response(null, { status: 401 })
    if (call === 3) return contextResponse("token-nuevo")
    if (call === 4) return new Response(null, { status: 200, headers: { Location: "https://upload.example/session-3" } })
    return Response.json({ id: "drive-file-3" })
  }
  try {
    assert.equal((await uploadPdfDirectlyToDrive(item, new Blob(["pdf"]))).id, "drive-file-3")
    assert.equal(call, 5)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test("reutiliza un archivo confirmado por su huella sin volver a subirlo", async () => {
  const originalFetch = globalThis.fetch
  let call = 0
  globalThis.fetch = async () => {
    call += 1
    return Response.json({ existingFile: { id: "drive-existing", webViewLink: "https://drive.example/existing" } })
  }
  try {
    assert.equal((await uploadPdfDirectlyToDrive(item, new Blob(["pdf"]))).id, "drive-existing")
    assert.equal(call, 1)
  } finally {
    globalThis.fetch = originalFetch
  }
})
