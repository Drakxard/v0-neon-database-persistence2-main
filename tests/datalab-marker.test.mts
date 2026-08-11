import assert from "node:assert/strict"
import test from "node:test"

import { convertFileWithDatalabMarker, convertPdfPageWithDatalabMarker, getDatalabMarkerApiKey } from "../lib/datalab-marker.ts"

const pagePdf = new File(["%PDF-1.4"], "pagina-2.pdf", { type: "application/pdf" })

test("usa MARKER_API con compatibilidad para marker_api", () => {
  assert.equal(getDatalabMarkerApiKey({ MARKER_API: " canonical " }), "canonical")
  assert.equal(getDatalabMarkerApiKey({ marker_api: "legacy" }), "legacy")
})

test("envia la pagina a Datalab y espera el markdown", async () => {
  const requests: Array<{ url: string; init?: RequestInit }> = []
  const markdown = await convertPdfPageWithDatalabMarker({
    file: pagePdf,
    apiKey: "test-key",
    wait: async () => undefined,
    fetchImpl: async (input, init) => {
      requests.push({ url: String(input), init })
      if (requests.length === 1) {
        return Response.json({ success: true, request_check_url: "https://www.datalab.to/api/v1/convert/request-1" })
      }
      return Response.json({ status: "complete", success: true, markdown: "# Pagina 2" })
    },
  })

  assert.equal(markdown, "# Pagina 2")
  assert.equal(requests[0].url, "https://www.datalab.to/api/v1/convert")
  assert.equal(new Headers(requests[0].init?.headers).get("X-API-Key"), "test-key")
  assert.equal(requests[1].url, "https://www.datalab.to/api/v1/convert/request-1")
})

test("acepta una imagen directamente sin envolverla en PDF", async () => {
  const image = new File(["jpeg"], "nota.jpg", { type: "image/jpeg" })
  let submittedBody: FormData | null = null
  const markdown = await convertFileWithDatalabMarker({
    file: image,
    apiKey: "key",
    wait: async () => undefined,
    fetchImpl: async (input, init) => {
      if (String(input).endsWith("/convert")) {
        submittedBody = init?.body as FormData
        return Response.json({ success: true, request_check_url: "https://www.datalab.to/api/v1/convert/image-1" })
      }
      return Response.json({ status: "complete", success: true, markdown: "Texto" })
    },
  })
  const submittedFile = (submittedBody as FormData | null)?.get("file") as File | null
  assert.equal(submittedFile?.name, "nota.jpg")
  assert.equal(submittedFile?.type, "image/jpeg")
  assert.equal(submittedFile?.size, image.size)
  assert.equal(markdown, "Texto")
})

test("informa clave ausente, fallo remoto y agotamiento de espera", async () => {
  await assert.rejects(() => convertPdfPageWithDatalabMarker({ file: pagePdf, apiKey: "" }), /MARKER_API/)
  await assert.rejects(
    () => convertPdfPageWithDatalabMarker({
      file: pagePdf,
      apiKey: "key",
      fetchImpl: async () => Response.json({ success: false, error: "credito agotado" }, { status: 402 }),
    }),
    /credito agotado/
  )
  await assert.rejects(
    () => convertPdfPageWithDatalabMarker({
      file: pagePdf,
      apiKey: "key",
      maxPollAttempts: 1,
      wait: async () => undefined,
      fetchImpl: async (input) => String(input).endsWith("/convert")
        ? Response.json({ success: true, request_check_url: "https://www.datalab.to/api/v1/convert/request-2" })
        : Response.json({ status: "processing" }),
    }),
    /tardo demasiado/
  )
})
