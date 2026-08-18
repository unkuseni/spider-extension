#!/usr/bin/env node
/**
 * Build the Safari distribution of the extension.
 *
 * Safari (WebExtensions via safari-web-extension-converter) differences:
 *  - no chrome.storage.sync            -> lib/storage.js falls back to storage.local
 *  - no chrome.sidePanel               -> openPanelUi opens the panel in a tab (background.js)
 *  - no runtime permission requests    -> host_permissions are declared up front
 *  - no optional_host_permissions / side_panel / minimum_chrome_version keys
 *  - background uses "scripts" (event page), not service_worker
 *
 * Usage: npm run build:safari -> dist/safari/
 * Then on macOS:
 *   xcrun safari-web-extension-converter dist/safari --app-name "Spider"
 *   (opens Xcode; build & run with your Apple Developer signing)
 */
import { cp, mkdir, rm, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "dist", "safari");

const DIRS = ["lib", "icons", "popup", "sidepanel", "options"];
const FILES = [
  "background.js",
  "vendor/leads-core.js",
  "vendor/leads-core.js.map",
  "vendor/pdf-extract.js",
  "vendor/pdf.worker.mjs",
];

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });

for (const dir of DIRS) await cp(join(root, dir), join(dist, dir), { recursive: true });
for (const file of FILES) await cp(join(root, file), join(dist, file));

const chromeManifest = JSON.parse(await readFile(join(root, "manifest.json"), "utf8"));
const safariManifest = {
  manifest_version: 3,
  name: chromeManifest.name,
  version: chromeManifest.version,
  description: chromeManifest.description,
  author: chromeManifest.author,
  icons: chromeManifest.icons,
  permissions: chromeManifest.permissions.filter((p) => p !== "sidePanel"),
  host_permissions: chromeManifest.host_permissions,
  background: { scripts: ["background.js"] },
  action: chromeManifest.action,
  options_ui: chromeManifest.options_ui,
  commands: chromeManifest.commands,
};
delete safariManifest.action.default_icon;

const safariNotes = [
  "# Safari build",
  "",
  "1. npm run build:safari (this folder was produced by it)",
  "2. On macOS: xcrun safari-web-extension-converter dist/safari --app-name \"Spider\"",
  "3. Xcode opens; set your team for signing, then Run — the extension appears in Safari → Settings → Extensions.",
  "4. Safari notes:",
  "   - no chrome.storage.sync → lib/storage.js falls back to storage.local (already handled)",
  "   - no side panel API → panel opens in a tab (already handled in background.js openPanelUi)",
  "   - no runtime host permissions → all hosts are declared up front; add sites you need to host_permissions in manifest.json before converting",
  "   - the assistant's chrome.permissions.request is skipped automatically (feature-detected)",
  "",
].join("\n");
await writeFile(join(dist, "SAFARI.md"), safariNotes);
await writeFile(join(dist, "manifest.json"), JSON.stringify(safariManifest, null, 2) + "\n");
console.log("Safari build ready at dist/safari (convert with safari-web-extension-converter on macOS)");