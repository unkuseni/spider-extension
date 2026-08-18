// PDF text extraction for the extension (bundled by scripts/build-pdf.mjs).
import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";

/** Extract plain text from a PDF (Uint8Array). */
export async function extractPdfText(data: Uint8Array): Promise<string> {
  const doc = await pdfjsLib.getDocument({ data, isEvalSupported: false, useSystemFonts: true }).promise;
  const parts: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    let line = "";
    for (const item of content.items as any[]) {
      const str = typeof item.str === "string" ? item.str : "";
      if (item.hasEOL) { parts.push(line + str); line = ""; }
      else line += str;
    }
    if (line) parts.push(line);
    parts.push("");
  }
  try { await doc.destroy(); } catch { /* pdf.js v6 may not expose destroy */ }
  return parts.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

export { pdfjsLib };
