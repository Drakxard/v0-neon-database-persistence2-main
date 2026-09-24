# Exportación SVG de Síntesis

La exportación usa `dom-to-svg` para generar texto, formas y elementos `image`
nativos. No usa `foreignObject`: mostrar HTML dentro de un SVG en Chrome no
valida su importación en Figma.

Las imágenes se incrustan con sus bytes originales, sin reducir su resolución.
El tamaño del archivo no permite determinar por sí solo si la exportación está
completa. El texto conserva el nombre de la fuente; Figma necesita tener esa
fuente disponible para reproducir exactamente su tipografía.

Prueba de regresión en Chromium (instalar el navegador una vez):

```sh
npx playwright install chromium
npm run test:svg
```

Comprueba SVG nativo, texto fuera de pantalla, tablas, numeración, casillas,
imágenes incrustadas sin recompresión, exclusión de controles y conservación de
la selección del editor. Una imagen que no puede incrustarse debe abortar la
descarga. Esta prueba no automatiza la importación dentro de Figma.

Referencia: https://github.com/felixfbecker/dom-to-svg
