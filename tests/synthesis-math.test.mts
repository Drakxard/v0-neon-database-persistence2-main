import assert from "node:assert/strict"
import test from "node:test"
import { normalizeSynthesisMath, synthesisMathRanges } from "../lib/synthesis-math.ts"
import { plainText } from "../lib/synthesis-workspace.ts"

test("NotebookLM conserva formato y convierte LaTeX dividido entre marcas", () => {
  const original = {type:"doc",content:[{type:"paragraph",content:[
    {type:"text",text:"Solución \\(y(x)="},
    {type:"text",text:"y_c(x)+y_p(x)\\)",marks:[{type:"bold"}]},
    {type:"text",text:" y constantes \\(c_1, c_2, \\dots, c_n\\).",marks:[{type:"italic"}]},
  ]}]}
  const normalized = normalizeSynthesisMath(original)
  const children = normalized.content![0].content!
  assert.equal(children.filter(node => node.type === "synthesisMath").length, 2)
  assert.equal(children[1].attrs!.latex, "y(x)=y_c(x)+y_p(x)")
  assert.equal(children.at(-1)!.marks![0].type,"italic")
  assert.match(plainText(normalized),/c_1, c_2, \\dots, c_n/)
  assert.deepEqual(normalizeSynthesisMath(normalized), normalized)
  assert.match(original.content[0].content[1].text,/\\\)/)
})

test("reconoce fórmulas en bloque y preserva dinero, delimitadores incompletos y código", () => {
  assert.deepEqual(synthesisMathRanges("Antes \\[f(x)=[a,b]\\] después").map(range => [range.latex,range.display]),[["f(x)=[a,b]",true]])
  assert.equal(synthesisMathRanges("$5 y $10; \\(incompleto").length,0)
  assert.equal(synthesisMathRanges("$$x^2$$ y $y_0$").length,2)
  assert.equal(synthesisMathRanges("$2x$")[0].latex,"2x")
  const code = {type:"codeBlock",content:[{type:"text",text:"\\(x\\)"}]}
  assert.equal(normalizeSynthesisMath(code),code)
})
