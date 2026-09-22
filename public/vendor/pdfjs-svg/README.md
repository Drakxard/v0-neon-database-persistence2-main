PDF.js 3.11.174 (Apache-2.0), copied from pdfjs-dist, supplies the SVGGraphics
backend removed from the main viewer's PDF.js version. Loaded only on SVG export.

pdf.mjs wraps build/pdf.min.js with local CommonJS exports and changes the UMD
target from globalThis to an empty object so it cannot replace the viewer's
pdfjsLib. pdf.worker.min.js is the matching unmodified worker. LICENSE is included.

Keep isEvalSupported disabled when loading documents with this legacy backend.
SVGGraphics has limited support for some PDF operators; complex transparency or
annotations may differ from the canvas viewer. Images originally raster remain
raster images embedded within the SVG.
