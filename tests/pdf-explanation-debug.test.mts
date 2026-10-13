import assert from "node:assert/strict"
import test from "node:test"
import { explanationDownload } from "../lib/pdf-explanation-debug.ts"

test("successful download contains the generated interactive HTML and escaped diagnostics", () => {
  const file = explanationDownload({ question: "Explicalo", page: 3, stage: "mostrar-explicacion", startedAt: "2026-10-12T22:00:00Z", outcome: "exito",
    html: "<html><body><button onclick='next()'>Siguiente</button></body></html>", wire: '<script>"$&"</script>' })
  assert.ok(file.filename.includes("pagina-3-exito"))
  assert.ok(file.html.includes("<button onclick='next()'>Siguiente</button>"))
  assert.ok(file.html.includes("&lt;script&gt;"))
  assert.ok(file.html.includes("$&"))
  assert.equal(file.html.match(/<\/body>/g)?.length, 1)
})

test("failure download explains the stage and preserves raw invalid HTML without executing it", () => {
  const file = explanationDownload({ question: "Duda", stage: "argumentos-herramienta-invalidos", startedAt: "2026-10-12T22:00:00Z", outcome: "fallo",
    error: "JSON incompleto", html: "<script>alert('raw')</script>", transcription: "Página original", responseBody: "HTTP failure" })
  assert.ok(file.filename.includes("fallo"))
  assert.ok(file.html.includes("argumentos-herramienta-invalidos"))
  assert.ok(file.html.includes("JSON incompleto"))
  assert.ok(file.html.includes("Página original"))
  assert.ok(file.html.includes("HTTP failure"))
  assert.ok(file.html.includes("&lt;script&gt;"))
  assert.ok(!file.html.includes("<script>"))
})
