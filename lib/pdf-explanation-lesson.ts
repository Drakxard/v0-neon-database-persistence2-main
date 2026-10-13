export type ExplanationLesson = {
  title: string
  steps: { title: string; text: string; items: string[]; result: string }[]
}

export const explanationLessonSchema = {
  type: "object", additionalProperties: false,
  properties: {
    title: { type: "string", minLength: 1, maxLength: 160 },
    steps: { type: "array", minItems: 2, maxItems: 4, items: {
      type: "object", additionalProperties: false,
      properties: {
        title: { type: "string", minLength: 1, maxLength: 100 },
        text: { type: "string", minLength: 1, maxLength: 650 },
        items: { type: "array", minItems: 2, maxItems: 5, items: { type: "string", minLength: 1, maxLength: 120 } },
        result: { type: "string", minLength: 1, maxLength: 350 },
      }, required: ["title", "text", "items", "result"],
    } },
  }, required: ["title", "steps"],
} as const

export function lessonHtml(input: unknown) {
  // Some Gateway providers encode array arguments as JSON strings. Decode only
  // these structural fields, then apply the same validation as native arrays.
  // Content strings stay literal text and are never interpreted as code.
  const decodeArray = (input: unknown) => {
    let value = input
    for (let depth = 0; depth < 2 && typeof value === "string" && value.length <= 32_000; depth++) {
      try { value = JSON.parse(value) } catch { break }
    }
    return value
  }
  const raw = input as ExplanationLesson | null
  const steps = decodeArray(raw?.steps)
  const lesson = { title: raw?.title, steps: Array.isArray(steps)
    ? steps.map(step => ({ ...step, items: decodeArray(step?.items) })) : steps } as ExplanationLesson
  const validString = (value: unknown, max: number) => typeof value === "string" && value.trim().length > 0 && value.length <= max
  if (!lesson || !validString(lesson.title, 160) || !Array.isArray(lesson.steps) || lesson.steps.length < 2 || lesson.steps.length > 4
    || lesson.steps.some(step => !step || !validString(step.title, 100) || !validString(step.text, 650) || !validString(step.result, 350)
      || !Array.isArray(step.items) || step.items.length < 2 || step.items.length > 5 || step.items.some(item => !validString(item, 120)))) {
    throw new Error("El modelo no entregó los pasos completos de la explicación.")
  }
  const data = JSON.stringify(lesson).replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029")
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Verlo</title><style>
*{box-sizing:border-box}body{margin:0;background:#eef2ff;color:#16223c;font:16px/1.6 system-ui;padding:clamp(12px,4vw,36px)}main{max-width:900px;margin:auto}h1{font-size:clamp(22px,4vw,34px);line-height:1.2}h2{line-height:1.3}.card{background:white;border-radius:24px;padding:clamp(18px,4vw,32px);box-shadow:0 12px 35px #22334a15;animation:appear .3s ease}p{white-space:pre-wrap}.visual{position:relative;padding-bottom:28px;display:flex;gap:10px;flex-wrap:wrap}.node{flex:1;min-width:110px;border:2px solid transparent;border-radius:16px;padding:14px;background:#e0f2fe;color:#075985;transition:transform .35s,box-shadow .35s,border-color .35s;white-space:pre-wrap}.node:nth-child(2n){background:#ede9fe;color:#5b21b6}.node:nth-child(3n){background:#fff1d6;color:#92400e}.node.active{border-color:currentColor;transform:translateY(-5px) scale(1.025);box-shadow:0 9px 18px #22334a20}.pointer{position:absolute;left:0;top:0;color:#7c3aed;transition:transform .55s cubic-bezier(.34,1.56,.64,1);font-size:24px;pointer-events:none}.result{background:#dcfce7;color:#166534;border-radius:16px;padding:16px;animation:appear .45s cubic-bezier(.34,1.56,.64,1);white-space:pre-wrap}nav{display:flex;justify-content:space-between;gap:12px;margin-top:18px}button{font:inherit;border:0;border-radius:12px;background:#4f46e5;color:white;padding:10px 18px;cursor:pointer}button:disabled{opacity:.4;cursor:default}progress{width:100%;accent-color:#7c3aed;margin-bottom:12px}.counter{color:#64748b}#replay{background:#e0e7ff;color:#3730a3;margin:0 0 14px}@keyframes appear{from{opacity:0;transform:translateY(8px) scale(.96)}to{opacity:1;transform:none}}@media(prefers-reduced-motion:reduce){*,*::before,*::after{animation:none!important;transition:none!important}}
</style></head><body><main><h1 id="title"></h1><p class="counter" id="counter"></p><progress id="progress"></progress><section id="screen" class="card"></section><nav><button id="prev">Anterior</button><button id="next">Siguiente</button></nav></main><script>
const lesson=${data};let index=0,timer;const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;const screen=document.getElementById('screen');document.getElementById('title').textContent=lesson.title;
function show(){clearTimeout(timer);const step=lesson.steps[index];screen.replaceChildren();screen.style.animation='none';void screen.offsetWidth;screen.style.animation='';const heading=document.createElement('h2');heading.textContent=step.title;const text=document.createElement('p');text.textContent=step.text;const visual=document.createElement('div');visual.className='visual';const nodes=step.items.map(label=>{const node=document.createElement('div');node.className='node';node.textContent=label;visual.append(node);return node});const pointer=document.createElement('span');pointer.className='pointer';pointer.textContent='▲';pointer.setAttribute('aria-hidden','true');visual.append(pointer);const replay=document.createElement('button');replay.id='replay';replay.textContent='Recorrer ejemplo';const result=document.createElement('div');result.className='result';result.textContent=step.result;screen.append(heading,text,visual,replay,result);let focus=0;function point(){nodes.forEach((n,i)=>n.classList.toggle('active',i===focus));const n=nodes[focus];pointer.style.transform='translate('+(n.offsetLeft+n.offsetWidth/2-12)+'px,'+(n.offsetTop+n.offsetHeight-2)+'px)';if(!reduced&&focus<nodes.length-1)timer=setTimeout(()=>{focus++;point()},1100)}replay.onclick=()=>{clearTimeout(timer);focus=0;point()};nodes.forEach((node,i)=>node.onclick=()=>{clearTimeout(timer);focus=i;point()});requestAnimationFrame(point);document.getElementById('counter').textContent='Paso '+(index+1)+' de '+lesson.steps.length;const progress=document.getElementById('progress');progress.max=lesson.steps.length;progress.value=index+1;document.getElementById('prev').disabled=index===0;document.getElementById('next').disabled=index===lesson.steps.length-1;}
document.getElementById('prev').onclick=()=>{if(index>0){index--;show()}};document.getElementById('next').onclick=()=>{if(index<lesson.steps.length-1){index++;show()}};show();
</script></body></html>`
}

export function lessonFromText(text: string) {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim()
  const start = trimmed.indexOf("{"), end = trimmed.lastIndexOf("}")
  if (start < 0 || end < start) return undefined
  try { return lessonHtml(JSON.parse(trimmed.slice(start, end + 1))) } catch { return undefined }
}
