#!/usr/bin/env node
/**
 * Bundle pdf.js for the extension.
 *  - vendor/pdf-extract.js   : main library + extractPdfText (esbuild)
 *  - vendor/pdf.worker.mjs   : worker script (copied as-is; loaded via workerSrc)
 */
import { build } from "esbuild";
import { copyFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const workerPath = require.resolve("pdfjs-dist/legacy/build/pdf.worker.mjs");

await mkdir(join(root, "vendor"), { recursive: true });
await build({
  entryPoints: [join(root, "vendor/pdf-entry.ts")],
  bundle: true,
  format: "esm",
  outfile: join(root, "vendor/pdf-extract.js"),
  platform: "browser",
  target: "chrome116",
  sourcemap: false,
  legalComments: "none",
  logLevel: "warning",
});
await copyFile(workerPath, join(root, "vendor/pdf.worker.mjs"));
console.log("pdf bundle ready (vendor/pdf-extract.js + vendor/pdf.worker.mjs)");
