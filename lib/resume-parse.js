/**
 * Resume text extraction for the extension — PDF (pdf.js bundle), DOCX (pure-JS
 * ZIP parse + DecompressionStream), and plain text. No server involved.
 */

const encoder = new TextEncoder();
const decoder = new TextDecoder();

// ---------------------------------------------------------------------------
// DOCX — it's a ZIP; we only need word/document.xml
// ---------------------------------------------------------------------------

async function inflateRaw(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  const buf = await new Response(stream).arrayBuffer();
  return new Uint8Array(buf);
}

function utf8(buf) {
  return decoder.decode(buf);
}

/** Minimal ZIP reader: find one entry by name, return its decompressed bytes. */
async function zipEntry(data, wantedName) {
  const ab = data instanceof ArrayBuffer ? data : data.buffer;
  const dv = new DataView(ab);
  const u8 = new Uint8Array(ab);

  // Locate End of Central Directory (PK)
  let eocd = -1;
  for (let i = data.byteLength - 22; i >= 0; i--) {
    if (u8[i] === 0x50 && u8[i + 1] === 0x4b && u8[i + 2] === 0x05 && u8[i + 3] === 0x06) { eocd = i; break; }
  }
  if (eocd === -1) throw new Error('Not a valid DOCX (no zip end record)');

  const entryCount = dv.getUint16(eocd + 10, true);
  let cdOffset = dv.getUint32(eocd + 16, true);

  for (let n = 0; n < entryCount; n++) {
    if (u8[cdOffset] !== 0x50 || u8[cdOffset + 1] !== 0x4b) break; // corrupt
    const method = dv.getUint16(cdOffset + 10, true);
    const compSize = dv.getUint32(cdOffset + 20, true);
    const nameLen = dv.getUint16(cdOffset + 28, true);
    const extraLen = dv.getUint16(cdOffset + 30, true);
    const commentLen = dv.getUint16(cdOffset + 32, true);
    const localOffset = dv.getUint32(cdOffset + 42, true);
    const name = utf8(u8.subarray(cdOffset + 46, cdOffset + 46 + nameLen));

    if (name === wantedName) {
      // Local file header at localOffset
      const lNameLen = dv.getUint16(localOffset + 26, true);
      const lExtraLen = dv.getUint16(localOffset + 28, true);
      const dataStart = localOffset + 30 + lNameLen + lExtraLen;
      const compressed = u8.subarray(dataStart, dataStart + compSize);
      if (method === 0) return utf8(compressed);
      if (method === 8) return utf8(await inflateRaw(compressed));
      throw new Error('Unsupported DOCX compression method: ' + method);
    }
    cdOffset += 46 + nameLen + extraLen + commentLen;
  }
  throw new Error('DOCX entry not found: ' + wantedName);
}

function xmlToText(xml) {
  return xml
    .replace(/<w:tab[^>]*\/?>/gi, '\t')
    .replace(/<w:br[^>]*\/?>/gi, '\n')
    .replace(/<w:p[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// ---------------------------------------------------------------------------
// PDF — pdf.js bundle (loaded lazily; ~1 MB)
// ---------------------------------------------------------------------------

async function pdfText(u8) {
  const mod = await import('../vendor/pdf-extract.js');
  const workerUrl = (typeof chrome !== 'undefined' && chrome.runtime?.getURL)
    ? chrome.runtime.getURL('vendor/pdf.worker.mjs')
    : 'vendor/pdf.worker.mjs';
  mod.pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;
  return mod.extractPdfText(u8);
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * Extract text from a resume File.
 * @returns {Promise<{text: string, format: string}>}
 */
export async function parseResumeFile(file) {
  const name = (file.name || '').toLowerCase();
  const format = name.endsWith('.pdf') ? 'pdf'
    : name.endsWith('.docx') ? 'docx'
    : name.endsWith('.txt') || name.endsWith('.md') || name.endsWith('.text') ? 'text'
    : 'unknown';

  if (format === 'text') return { text: await file.text(), format };
  const buf = await file.arrayBuffer();
  const u8 = new Uint8Array(buf);
  if (format === 'pdf') return { text: await pdfText(u8), format };
  if (format === 'docx') {
    const xml = await zipEntry(buf, 'word/document.xml');
    return { text: xmlToText(xml), format };
  }
  // Unknown extension: try docx first, then raw text
  try {
    const xml = await zipEntry(buf, 'word/document.xml');
    return { text: xmlToText(xml), format: 'docx' };
  } catch {
    return { text: await file.text(), format: 'text' };
  }
}

export { xmlToText, zipEntry };
