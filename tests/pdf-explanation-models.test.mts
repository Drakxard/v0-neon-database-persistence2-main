import assert from "node:assert/strict"
import test from "node:test"
import { chooseFreeExplanationModels, DEFAULT_FREE_EXPLANATION_MODEL } from "../lib/server/pdf-explanation-models.ts"

const free = (id: string) => ({ id, type: "language", tags: ["free", "tool-use"], supported_parameters: ["tools", "tool_choice"], max_tokens: 32768, pricing: { input: "0", output: "0" } })

test("old paid environment preference is ignored and all fallback models have zero prices", () => {
  const paid = { ...free("anthropic/claude-sonnet-4.5"), pricing: { input: "0.000003", output: "0.000015" } }
  const catalog = { data: [paid, free("inclusionai/ling-3.1-flash-free"), free(DEFAULT_FREE_EXPLANATION_MODEL)] }
  const models = chooseFreeExplanationModels(catalog, paid.id)
  assert.equal(models[0].id, DEFAULT_FREE_EXPLANATION_MODEL)
  assert.deepEqual(models.map(model => model.id), [DEFAULT_FREE_EXPLANATION_MODEL, "inclusionai/ling-3.1-flash-free"])
})

test("expired promotions, unsupported tools, missing prices and decision models cannot be selected", () => {
  const candidates = [
    { ...free("expired"), deprecated_at: 100 },
    { ...free("no-forced-tool"), supported_parameters: ["tools"] },
    { ...free("missing-price"), pricing: { input: "", output: "0" } },
    { ...free("evaluation"), type: "evaluation" },
    { ...free("promo-ended"), pricing: { input: "0", output: "0.000001" } },
  ]
  assert.throws(() => chooseFreeExplanationModels({ data: candidates }, undefined, 101), /sin usar modelos pagos/)
  assert.throws(() => chooseFreeExplanationModels({}), /catálogo/)
})

test("a still-free preferred model is respected and output tokens fit its limit", () => {
  const model = { ...free("free-preference"), max_tokens: 8192 }
  assert.deepEqual(chooseFreeExplanationModels({ data: [free(DEFAULT_FREE_EXPLANATION_MODEL), model] }, model.id)[0], { id: model.id, maxOutputTokens: 8192 })
})
