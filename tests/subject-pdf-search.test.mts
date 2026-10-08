import assert from "node:assert/strict"
import test from "node:test"
import { buildPdfCandidates, chosenClefOption, htmlToPdfText, normalizePdfQuery, normalizedPdfRegion, parsePdfExtraction, pdfEvaluationCacheKey, pdfResultTitle, pdfTextMatches, type PdfCandidate } from "../lib/subject-pdf-search.ts"
import { evaluatePdfCandidate } from "../lib/server/subject-pdf-clef.ts"
import { evaluatePdfWordUnits } from "../lib/server/subject-pdf-words.ts"
import { pollDatalabFragments, signDatalabJob, submitDatalabFragments, verifyDatalabJob } from "../lib/server/datalab-fragments.ts"
import { getDatalabMarkerApiKey } from "../lib/datalab-marker.ts"

// Marker-compatible response structure; provider fixtures are structural, not evidence of OCR quality.
function payload() {
  return { json: { block_type: "Document", children: [
    { id: "/page/0", block_type: "Page", bbox: [0, 0, 600, 800], children: [
      { id: "/page/0/SectionHeader/0", block_type: "SectionHeader", bbox: [40, 40, 280, 60], html: "<h2>TEOREMA 7.2.1 Algunas transformadas inversas</h2>" },
      { id: "/page/0/Text/1", block_type: "Text", bbox: [40, 65, 280, 110], html: "<p>Si las funciones son de orden exponencial, sus transformadas inversas existen.</p>" },
      { id: "/page/0/Text/2", block_type: "Text", bbox: [40, 115, 280, 150], html: "<p>Demostración: consideremos la función...</p>" },
      { id: "/page/0/SectionHeader/3", block_type: "SectionHeader", bbox: [320, 40, 560, 60], html: "<h2>TEOREMA 7.2.2 Transformada de una derivada</h2>" },
      { id: "/page/0/Text/4", block_type: "Text", bbox: [320, 65, 560, 110], html: "<p>La transformada de la derivada es <math>sF(s)-f(0)</math>.</p>" },
      { id: "/page/0/SectionHeader/5", block_type: "SectionHeader", bbox: [40, 200, 280, 220], html: "<h2>DEFINICIÓN 7.1.2 Orden exponencial</h2>" },
      { id: "/page/0/Text/6", block_type: "Text", bbox: [40, 225, 280, 280], html: "<p>Una función tiene orden exponencial si está acotada por una exponencial.</p>" },
      { id: "/page/0/PageFooter/7", block_type: "PageFooter", bbox: [0, 780, 600, 800], html: "<p>7</p>" },
    ] },
    { id: "/page/1", block_type: "Page", polygon: [[0, 0], [600, 0], [600, 800], [0, 800]], children: [
      { id: "/page/1/SectionHeader/0", block_type: "SectionHeader", bbox: [40, 40, 560, 70], html: "<h2>Ejercicios</h2>" },
      { id: "/page/1/Text/1", block_type: "Text", bbox: [40, 90, 560, 150], html: "<p>Aplique el teorema 7.2.2 para resolver el ejercicio.</p>" },
    ] },
  ] }, markdown: "# Apuntes", metadata: { failed_pages: [1] } }
}
test("normaliza consultas genéricas y no confunde una subcadena con una palabra", () => {
  assert.equal(normalizePdfQuery("  DEFINICIÓN  Teo "), "definicion teorema")
  assert.equal(pdfTextMatches("Teorema de funciones", "teoremas"), true)
  assert.equal(pdfTextMatches("Definición de orden exponencial", "definicion exponencial"), true)
  assert.equal(pdfTextMatches("Economía: mercados", "mercado"), true)
  assert.equal(pdfTextMatches("integrales", "integral"), true)
  assert.equal(pdfTextMatches("orden", "red"), false)
  assert.equal(pdfTextMatches("TEOREMA 7.2.1", "7.2.2"), false)
  assert.equal(pdfTextMatches("TEOREMA 7.2.2", "7.2.2"), true)
  assert.equal(pdfTextMatches("Σ y λ", "λ"), true)
  assert.equal(pdfTextMatches("texto", ""), false)
  assert.equal(htmlToPdfText("<p>Transformada &amp; derivada &#243;</p><script>evil()</script>"), "Transformada & derivada ó")
})
test("conserva páginas originales, fórmulas, orden y regiones de distintas columnas", () => {
  const extraction = parsePdfExtraction(payload(), [7, 8])
  assert.equal(extraction.blocks.length, 9)
  assert.deepEqual(extraction.failedPages, [8])
  assert.equal(extraction.blocks[0].page, 7)
  assert.equal(extraction.blocks[7].page, 8)
  assert.equal(extraction.blocks[4].text.includes("sF(s)-f(0)"), true)
  assert.ok(extraction.blocks[0].region!.x2 < extraction.blocks[3].region!.x1)
  assert.deepEqual(extraction.raw, payload().json)
  assert.equal(extraction.blocks[0].region!.y1, 0.05)
})
test("rechaza geometría inválida en vez de fabricar un recorte", () => {
  assert.equal(normalizedPdfRegion([10, 10, 20, 20], null, 1), null)
  assert.equal(normalizedPdfRegion([10, 10, 700, 20], [0, 0, 600, 800], 1), null)
  assert.equal(normalizedPdfRegion([20, 10, 10, 20], [0, 0, 600, 800], 1), null)
  assert.throws(() => parsePdfExtraction({ json: {} }, [1]), /bloques/)
  assert.deepEqual(parsePdfExtraction(payload(), [1, 2, 3]).failedPages, [2, 3])
})
test("reúne coincidencias de un pasaje y conserva títulos originales sin categorías obligatorias", () => {
  const extraction = parsePdfExtraction(payload(), [1, 2])
  const candidates = buildPdfCandidates(extraction.blocks, "teorema")
  assert.equal(candidates.length, 3)
  assert.match(candidates[0].title, /^TEOREMA 7\.2\.1/)
  assert.match(candidates[1].title, /^TEOREMA 7\.2\.2/)
  assert.equal(buildPdfCandidates(extraction.blocks, "orden exponencial").length, 2)
  const generic = extraction.blocks.map((b) => ({ ...b, text: b.text.replaceAll("TEOREMA", "PROCEDIMIENTO") }))
  assert.equal(buildPdfCandidates(generic, "procedimiento").length, 2)
})
test("una consulta repetida comparte clave y una nueva consulta o PDF la cambia", () => {
  assert.equal(pdfEvaluationCacheKey("a", "DEFINICIÓN"), pdfEvaluationCacheKey("a", "definicion"))
  assert.notEqual(pdfEvaluationCacheKey("a", "teorema"), pdfEvaluationCacheKey("b", "teorema"))
  assert.notEqual(pdfEvaluationCacheKey("a", "teorema"), pdfEvaluationCacheKey("a", "derivada"))
})
test("Clef valida los candidatos y selecciona exclusivamente IDs del original", async () => {
  const candidate = buildPdfCandidates(parsePdfExtraction(payload(), [1, 2]).blocks, "teorema")[0]
  let calls = 0
  const decision = await evaluatePdfCandidate("teorema", candidate, async (state, questions) => {
    calls++
    if (calls === 1) {
      assert.match(questions.relevance.instructions, /sin exigir una categoría/)
      return { answers: { relevance: { choice: "contenido_desarrollado" } } }
    }
    assert.deepEqual((state as { coincidencias: string[] }).coincidencias, candidate.anchorIds)
    return { answers: Object.fromEntries(candidate.blocks.map((b, i) => [`b${i}`, { choice: i === 2 ? "excluir" : "incluir" }])) }
  })
  assert.equal(calls, 2)
  assert.equal(decision.accepted, true)
  assert.deepEqual(decision.blockIds, candidate.blocks.slice(0, 2).map((b) => b.id))
  assert.equal(pdfResultTitle(candidate, decision), candidate.title)
})
test("menciones, índices y consignas son rechazados; fallas no se presentan como rechazo", async () => {
  const candidate = buildPdfCandidates(parsePdfExtraction(payload(), [1, 2]).blocks, "teorema").at(-1)!
  for (const choice of ["mencion_o_remision", "consigna_sin_desarrollo", "incierto"]) {
    let calls = 0
    const decision = await evaluatePdfCandidate("teorema", candidate, async () => { calls++; return { answers: { relevance: { choice } } } })
    assert.equal(decision.accepted, false); assert.equal(calls, 1)
  }
  await assert.rejects(evaluatePdfCandidate("teorema", candidate, async () => { throw new Error("Servicio no disponible") }), /no disponible/)
  await assert.rejects(evaluatePdfCandidate("teorema", candidate, async () => ({ answers: { relevance: { choice: "inventada" } } })), /no reconocible/)
})
test("detecta bloques mixtos y refina unidades sin generar texto", async () => {
  const candidate = buildPdfCandidates(parsePdfExtraction(payload(), [1, 2]).blocks, "teorema")[0]
  let calls = 0
  const decision = await evaluatePdfCandidate("teorema", candidate, async (_, questions) => {
    calls++
    return { answers: Object.fromEntries(Object.keys(questions).map((id) => [id, { choice: calls === 1 ? "contenido_desarrollado" : "parcial" }])) }
  })
  assert.deepEqual(decision.partialIds, candidate.blocks.map((b) => b.id))
  const units = [{ id: "u0", text: "Enunciado.", regions: [] }, { id: "u1", text: "Ejercicio.", regions: [] }]
  const refined = await evaluatePdfWordUnits("teorema", candidate.title, units, async () => ({ answers: { u0: { choice: "incluir" }, u1: { choice: "excluir" } } }))
  assert.deepEqual(refined, { ids: ["u0"], uncertain: false })
  assert.equal(chosenClefOption({ probabilities: { incluir: 0.8, excluir: 0.2 } }, ["incluir", "excluir"]), "incluir")
  assert.throws(() => chosenClefOption({ incluir: 0.5, excluir: 0.5 }, ["incluir", "excluir"]), /no reconocible/)
})
test("reúne un título partido y continúa el enunciado en otra página", () => {
  const blocks = parsePdfExtraction(payload(), [1, 2]).blocks.slice(0, 3)
  blocks[0] = { ...blocks[0], text: "TEOREMA 7.2.1" }
  blocks[1] = { ...blocks[1], type: "SectionHeader", text: "Algunas transformadas inversas", html: "<h3>Algunas transformadas inversas</h3>" }
  blocks[2] = { ...blocks[2], page: 2, text: "Las transformadas inversas existen." }
  const candidates = buildPdfCandidates(blocks, "teorema inversas")
  assert.equal(candidates.length, 1)
  assert.equal(candidates[0].blocks.length, 3)
  assert.equal(pdfResultTitle(candidates[0], { id: candidates[0].id, accepted: true, blockIds: blocks.map((b) => b.id), partialIds: [] }), "TEOREMA 7.2.1 Algunas transformadas inversas")
})

test("datalab es la configuración principal y los trabajos firmados resisten manipulación y caducidad", (t) => {
  const previous = process.env.datalab
  process.env.datalab = "test-datalab-key"
  t.after(() => { if (previous === undefined) delete process.env.datalab; else process.env.datalab = previous })
  assert.equal(getDatalabMarkerApiKey({ datalab: " new ", MARKER_API: "old" }), "new")
  const token = signDatalabJob("request-1", "owner", false, 100)
  assert.equal(verifyDatalabJob(token, "owner", 101).id, "request-1")
  assert.throws(() => verifyDatalabJob(token, "other", 101), /no es válido/)
  assert.throws(() => verifyDatalabJob(token.slice(0, -2) + "XX", "owner", 101), /no es válido/)
  assert.throws(() => verifyDatalabJob(token, "owner", 24 * 60 * 60 * 1000), /venció/)
})
test("envía balanced/json y descarga result_url sin exponer la clave", async (t) => {
  const previous = process.env.datalab
  process.env.datalab = "test-datalab-key"
  t.after(() => { if (previous === undefined) delete process.env.datalab; else process.env.datalab = previous })
  const submitted = await submitDatalabFragments(new File(["%PDF"], "file.pdf"), "owner", false, async (_, init) => {
    const form = init!.body as FormData
    assert.equal(form.get("mode"), "balanced")
    assert.equal(form.get("output_format"), "json,markdown")
    assert.equal(new Headers(init!.headers).get("X-API-Key"), "test-datalab-key")
    return Response.json({ success: true, request_check_url: "https://www.datalab.to/api/v1/convert/request-1" })
  })
  let calls = 0
  const result = await pollDatalabFragments(submitted.token, "owner", async (url, init) => {
    calls++
    if (calls === 1) return Response.json({ status: "complete", success: true, result_url: "https://results.datalab.to/signed" })
    assert.equal(String(url), "https://results.datalab.to/signed")
    assert.equal(new Headers(init?.headers).has("X-API-Key"), false)
    return Response.json({ success: true, ...payload() })
  })
  assert.equal(result.status, "complete"); assert.equal(calls, 2)
  await assert.rejects(pollDatalabFragments(submitted.token, "owner", async () => Response.json({ status: "complete", success: false })), /no pudo completar/)
  await assert.rejects(submitDatalabFragments(new File(["%PDF"], "file.pdf"), "owner", false, async () => Response.json({ success: true, request_check_url: "https://evil.test/api/v1/convert/a" })), /inválido/)
})
