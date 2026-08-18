#!/usr/bin/env node
/**
 * Build the Firefox distribution of the extension.
 *
 * Firefox (WebExtensions MV3) differences handled here:
 *  - background: "scripts" event page (service_worker is not supported)
 *  - no sidePanel API / permission / manifest key (panel opens in a tab — see background.js openPanelUi)
 *  - no minimum_chrome_version
 *
 * Usage: npm run build:firefox   →   dist/firefox/
 * Validate: npm run lint:firefox  (web-ext lint)
 */

import { cp, mkdir, rm, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "dist", "firefox");

const DIRS = ["lib", "icons", "popup", "sidepanel", "options"];
const FILES = [
  "background.js",
  "manifest.firefox.json",
  "vendor/leads-core.js",
  "vendor/leads-core.js.map",
];

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });

for (const dir of DIRS) {
  await cp(join(root, dir), join(dist, dir), { recursive: true });
}
for (const file of FILES) {
  await cp(join(root, file), join(dist, file));
}

// Firefox build uses manifest.json (copy of manifest.firefox.json)
await writeFile(join(dist, "manifest.json"), await readFile(join(root, "manifest.firefox.json")));

const size = (await import("node:fs/promises")).stat;
console.log("Firefox build ready at dist/firefox");
console.log("  - validate : npm run lint:firefox");
console.log("  - run      : npx web-ext run --source-dir dist/firefox");
