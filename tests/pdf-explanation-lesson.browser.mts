import assert from "node:assert/strict"
import test from "node:test"
import { readFileSync } from "node:fs"
import { chromium } from "@playwright/test"
import { lessonHtml } from "../lib/pdf-explanation-lesson.ts"
import { explanationHtml } from "../lib/pdf-explanation.ts"

test("the lesson recovered from the reported failure displays and navigates all three pages", async () => {
  const input = JSON.parse(readFileSync(new URL("./fixtures/pdf-explanation-string-steps.json", import.meta.url), "utf8"))
  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage()
  const errors: string[] = []
  page.on("pageerror", error => errors.push(error.message))
  try {
    await page.setContent(explanationHtml(lessonHtml(input)))
    await page.getByRole("heading", { name: input.title, exact: true }).waitFor()
    for (const step of JSON.parse(input.steps)) {
      await page.getByRole("heading", { name: step.title, exact: true }).waitFor()
      assert.equal(await page.locator(".node").count(), step.items.length)
      assert.equal(await page.locator(".result").textContent(), step.result)
      if (!(await page.getByRole("button", { name: "Siguiente" }).isDisabled())) await page.getByRole("button", { name: "Siguiente" }).click()
    }
    assert.equal(await page.locator("#counter").textContent(), "Paso 3 de 3")
    assert.deepEqual(errors, [])
  } finally { await browser.close() }
})

test("the generated lesson HTML works offline with steps, pointer highlights and reduced motion", async () => {
  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ reducedMotion: "reduce" })
  const errors: string[] = []
  page.on("pageerror", error => errors.push(error.message))
  try {
    const html = explanationHtml(lessonHtml({ title: "Costo de búsqueda", steps: [
      { title: "Búsqueda directa", text: "Se compara la clave en h(k).", items: ["h(k)", "Clave encontrada"], result: "Costo O(1)." },
      { title: "Colisión", text: "Un intento infructuoso requiere otra comparación.", items: ["Cubeta ocupada", "Nuevo intento"], result: "Más intentos aumentan el costo." },
    ] }))
    await page.setContent(html)
    await page.getByRole("heading", { name: "Búsqueda directa" }).waitFor()
    assert.equal(await page.getByRole("button", { name: "Anterior" }).isDisabled(), true)
    await page.locator(".node.active").waitFor()
    await page.getByRole("button", { name: "Siguiente" }).click()
    await page.getByRole("heading", { name: "Colisión", exact: true }).waitFor()
    assert.equal(await page.getByRole("button", { name: "Siguiente" }).isDisabled(), true)
    await page.locator(".node").nth(1).click()
    assert.equal(await page.locator(".node.active").textContent(), "Nuevo intento")
    await page.getByRole("button", { name: "Recorrer ejemplo" }).click()
    assert.equal(await page.locator(".node.active").textContent(), "Cubeta ocupada")
    await page.getByRole("button", { name: "Anterior" }).click()
    await page.getByRole("heading", { name: "Búsqueda directa" }).waitFor()
    assert.deepEqual(errors, [])
  } finally { await browser.close() }
})
