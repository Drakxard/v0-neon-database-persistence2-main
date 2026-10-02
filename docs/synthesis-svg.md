# Exportación SVG de Síntesis

Las imágenes usan una copia de `exportImage` de `Secuencial/app.js`, en
`lib/svg-image.ts`: `<image href="data:…" preserveAspectRatio="none"/>`, con
coordenadas redondeadas a dos decimales. Son hijos directos del SVG, sin pasar
por las máscaras, grupos o serialización de imágenes del conversor DOM.

`dom-to-svg` se usa para el texto y las formas. No usa `foreignObject`: mostrar
HTML dentro de un SVG en Chrome no valida su importación en Figma.
Cada línea se convierte en un elemento `text` independiente con posición y
formato explícitos. Se eliminan `textLength` y `lengthAdjust="spacingAndGlyphs"`
para que no se estiren ni compriman los glifos según las métricas del importador.

Las imágenes se incrustan con sus bytes originales, sin reducir su resolución.
El tamaño del archivo no permite determinar por sí solo si la exportación está
completa. Las fuentes web de las familias utilizadas se incrustan como datos
en reglas `@font-face`, incluyendo las hojas cargadas mediante `@import`.
Esto conserva la tipografía al abrir el SVG en un navegador sin conexión y
evita sustituirla por otra fuente. Las fuentes del sistema permanecen nativas.
Figma necesita tener la fuente disponible, ya que no usa las fuentes web
incrustadas para importar texto editable.

Prueba de regresión en Chromium (instalar el navegador una vez):

```sh
npx playwright install chromium
npm run test:svg
```

Comprueba SVG nativo, texto fuera de pantalla, tablas, numeración, casillas,
imágenes grandes incrustadas sin recompresión, estructura de imágenes igual a
Secuencial, coordenadas fuera de pantalla, exclusión de controles y conservación de
la selección del editor. Una imagen que no puede incrustarse debe abortar la
descarga. También comprueba que una fuente importada se incruste, que las
familias no utilizadas queden fuera y que los glifos utilicen la fuente en
un SVG abierto como imagen sin conexión. Esta prueba no automatiza la
importación dentro de Figma.

Referencia: https://github.com/felixfbecker/dom-to-svg
