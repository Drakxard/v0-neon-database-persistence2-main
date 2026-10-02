// A standalone SVG cannot resolve the editor's external web fonts. Collect
// only families used by exported text, including fonts in @import sheets.
export async function embedSvgFonts(svg: Element): Promise<void> {
  const familyName = (value: string) => value.trim().replace(/^['"]|['"]$/g, "").toLowerCase()
  const families = new Set(Array.from(svg.querySelectorAll("text"))
    .flatMap((text) => (text.getAttribute("font-family") ?? "").split(",").map(familyName)))
  const visited = new Set<CSSStyleSheet>()
  const fonts: CSSFontFaceRule[] = []
  const bases = new Map<CSSFontFaceRule, string>()

  async function visitSheet(sheet: CSSStyleSheet): Promise<void> {
    if (visited.has(sheet)) return
    visited.add(sheet)
    let rules: CSSRuleList
    try {
      rules = sheet.cssRules
    } catch {
      // Cross-origin CSSOM access is blocked even for loaded web fonts.
      // Fetch the CSS through CORS and parse it with the browser's CSS parser.
      if (!sheet.href) return
      const response = await fetch(sheet.href)
      if (!response.ok) throw new Error("No se pudieron incrustar las fuentes del SVG.")
      const parsed = new CSSStyleSheet()
      parsed.replaceSync(await response.text())
      rules = parsed.cssRules
    }
    await visitRules(rules, sheet.href ?? document.baseURI)
  }

  async function visitRules(rules: CSSRuleList, base: string): Promise<void> {
    for (const rule of Array.from(rules)) {
      if (rule instanceof CSSFontFaceRule && families.has(familyName(rule.style.getPropertyValue("font-family")))) {
        fonts.push(rule)
        bases.set(rule, base)
      } else if (rule instanceof CSSImportRule && rule.styleSheet) {
        await visitSheet(rule.styleSheet)
      } else if ("cssRules" in rule) {
        await visitRules((rule as CSSGroupingRule).cssRules, base)
      }
    }
  }

  await Promise.all(Array.from(document.styleSheets, visitSheet))
  const resources = new Map<string, Promise<string>>()
  const declarations = await Promise.all(fonts.map(async (font) => {
    const source = font.style.getPropertyValue("src")
    const match = /url\(\s*(?:"([^"]+)"|'([^']+)'|([^\s)]+))\s*\)/i.exec(source)
    if (!match) return "" // System fonts declared with local() stay native.
    const url = new URL(match[1] ?? match[2] ?? match[3], bases.get(font)).href
    if (!resources.has(url)) resources.set(url, fontDataUrl(url))
    const sheet = new CSSStyleSheet()
    sheet.replaceSync(font.cssText)
    const declaration = (sheet.cssRules[0] as CSSFontFaceRule).style
    // Omit local() alternatives so a different installed version cannot win.
    declaration.setProperty("src", `url("${await resources.get(url)}")`)
    return `@font-face{${declaration.cssText}}`
  }))
  if (declarations.some(Boolean)) {
    const style = svg.ownerDocument.createElementNS("http://www.w3.org/2000/svg", "style")
    style.textContent = declarations.join("\n")
    svg.prepend(style)
  }
}

async function fontDataUrl(url: string): Promise<string> {
  if (url.startsWith("data:")) return url
  const response = await fetch(url)
  if (!response.ok) throw new Error("No se pudo incrustar una fuente del SVG.")
  const blob = await response.blob()
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })
}
