# Exportación SVG de Síntesis

El botón ↓ del editor usa el mismo método de exportación visual que PDF.js:
renderizado a escala 2 y JPEG de calidad 0.92 incrustado en un SVG sencillo.
Ambos comparten `canvasSvgImage`, `SVG_RENDER_SCALE` y `buildRasterSvg` de
`public/pdfjs/web/raster-svg.mjs`.

`lib/client/synthesis-svg.ts` copia el contenido y los estilos calculados del
editor, excluye sus controles y prepara imágenes y fuentes como datos locales.
El navegador renderiza esa copia mediante un SVG intermedio con `foreignObject`.
El archivo descargado sólo contiene un fondo y elementos `<image href="data:…">`;
no contiene HTML, referencias externas ni `foreignObject`.

La apariencia del texto, las tablas y las imágenes queda incorporada en el
renderizado. Como en la exportación de PDF.js, el texto no es editable como
vector y ampliar por encima de la resolución renderizada muestra píxeles.
Las fuentes utilizadas, incluidas las de hojas `@import`, se incrustan antes de
renderizar para conservar sus glifos al abrir el archivo sin conexión.

El documento completo se divide en franjas de hasta 2048 px de alto, sin huecos
entre ellas, para evitar el límite de altura del canvas. PDF.js conserva la
separación de 16 px entre páginas. La exportación no altera el documento,
la selección ni el desplazamiento del editor. Si falla, el botón muestra el
error en pantalla y permite reintentar; se desactiva durante la exportación.

Prueba de regresión en Chromium (instalar el navegador una vez):

```sh
npx playwright install chromium
npm run test:svg
```

Comprueba el serializador compartido, la descarga, el renderizado de texto,
tablas, listas e imágenes fuera de pantalla, la exclusión de controles y la
conservación de la selección. Una imagen que no puede incrustarse aborta la
descarga. También verifica fuentes importadas en un SVG abierto sin conexión y
el contenido final de un documento de más de 32767 px de alto. No automatiza
la importación dentro de Figma.
