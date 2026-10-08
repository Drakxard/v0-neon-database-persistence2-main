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
entre ellas, con un máximo de 4 millones de píxeles por lienzo a escala 2.
Cada franja prepara solo los bloques cercanos a su área visible; los demás
conservan su espacio y márgenes sin copiar sus fórmulas y contenido interno.
El `foreignObject` mide lo mismo que la franja, y la imagen intermedia y el
lienzo se liberan antes de preparar la siguiente. Esto reduce la memoria
usada por documentos largos con muchas fórmulas. PDF.js conserva la
separación de 16 px entre páginas. La exportación no altera el documento,
la selección ni el desplazamiento del editor. Si falla, el botón muestra el
error en pantalla y permite reintentar; se desactiva durante la exportación.
Una ventana muestra el progreso y permite cancelar. El procesamiento cede
tiempo al navegador entre bloques para atender eventos y pintar la interfaz.

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
También comprueba progreso, cancelación, caracteres de texto inválidos en XML
y el editor Tiptap real con sus separadores de cursor. Una prueba con fórmulas
en múltiples franjas verifica que no se incluyan las fórmulas fuera del área
visible, que todas las franjas respeten el límite de píxeles y que el texto
renderizado sobreviva a lo largo del documento.
