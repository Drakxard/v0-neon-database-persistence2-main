import { build } from "esbuild"

await build({
  entryPoints: ["lib/client/pdf-explanation-ui.ts"],
  outfile: "public/pdfjs/web/viewer-explanation-sdk.js",
  bundle: true,
  platform: "browser",
  format: "iife",
  target: "es2022",
  minify: true,
  legalComments: "eof",
})
