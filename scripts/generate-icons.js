/**
 * Generate PNG icons for the Spider extension.
 * Pure Node.js — no dependencies required.
 *
 * Usage: node scripts/generate-icons.js
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ICONS_DIR = path.join(__dirname, '..', 'icons');

// ---- CRC32 (PNG uses CRC-32 everywhere) ----
function crc32(buf) {
  let c;
  const table = [];
  for (let n = 0; n < 256; n++) {
    c = n;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[n] = c;
  }
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) {
    crc = table[(crc ^ buf[i]) & 0xFF] ^ (crc >>> 8);
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

// ---- PNG chunk ----
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeB = Buffer.from(type, 'ascii');
  const crcInput = Buffer.concat([typeB, data]);
  const crcVal = Buffer.alloc(4);
  crcVal.writeUInt32BE(crc32(crcInput), 0);
  return Buffer.concat([len, typeB, data, crcVal]);
}

// ---- Generate a PNG from raw RGBA pixels ----
function encodePNG(width, height, pixels) {
  // Filter each row with filter byte 0 (None)
  const rawRows = [];
  for (let y = 0; y < height; y++) {
    const row = Buffer.alloc(1 + width * 4);
    row[0] = 0; // filter: None
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      row[1 + x * 4 + 0] = pixels[idx];     // R
      row[1 + x * 4 + 1] = pixels[idx + 1]; // G
      row[1 + x * 4 + 2] = pixels[idx + 2]; // B
      row[1 + x * 4 + 3] = pixels[idx + 3]; // A
    }
    rawRows.push(row);
  }

  const rawData = Buffer.concat(rawRows);
  const compressed = zlib.deflateSync(rawData);

  // PNG signature
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  // IHDR
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // color type: RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  return Buffer.concat([
    signature,
    chunk('IHDR', ihdr),
    chunk('IDAT', compressed),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---- Drawing helpers ----
function createPixelBuffer(w, h) {
  return Buffer.alloc(w * h * 4, 0);
}

function fillRect(pixels, w, h, x, y, rw, rh, r, g, b, a) {
  for (let dy = 0; dy < rh; dy++) {
    for (let dx = 0; dx < rw; dx++) {
      const px = x + dx, py = y + dy;
      if (px < 0 || px >= w || py < 0 || py >= h) continue;
      const idx = (py * w + px) * 4;
      pixels[idx] = r; pixels[idx + 1] = g; pixels[idx + 2] = b; pixels[idx + 3] = a;
    }
  }
}

function drawCircle(pixels, w, h, cx, cy, radius, r, g, b, a) {
  for (let y = -radius; y <= radius; y++) {
    for (let x = -radius; x <= radius; x++) {
      if (x * x + y * y <= radius * radius) {
        const px = cx + x, py = cy + y;
        if (px < 0 || px >= w || py < 0 || py >= h) continue;
        const idx = (py * w + px) * 4;
        pixels[idx] = r; pixels[idx + 1] = g; pixels[idx + 2] = b; pixels[idx + 3] = a;
      }
    }
  }
}

function drawLine(pixels, w, h, x1, y1, x2, y2, thickness, r, g, b, a) {
  const dx = x2 - x1, dy = y2 - y1;
  const steps = Math.max(Math.abs(dx), Math.abs(dy));
  for (let i = 0; i <= steps; i++) {
    const t = steps === 0 ? 0 : i / steps;
    const px = Math.round(x1 + dx * t);
    const py = Math.round(y1 + dy * t);
    for (let tx = -Math.floor(thickness / 2); tx <= Math.floor(thickness / 2); tx++) {
      for (let ty = -Math.floor(thickness / 2); ty <= Math.floor(thickness / 2); ty++) {
        const sx = px + tx, sy = py + ty;
        if (sx < 0 || sx >= w || sy < 0 || sy >= h) continue;
        const idx = (sy * w + sx) * 4;
        pixels[idx] = r; pixels[idx + 1] = g; pixels[idx + 2] = b; pixels[idx + 3] = a;
      }
    }
  }
}

// ---- Generate an icon at a given size ----
function generateIcon(size) {
  const w = size, h = size;
  const pixels = createPixelBuffer(w, h);

  // Purple background
  fillRect(pixels, w, h, 0, 0, w, h, 0x7c, 0x5c, 0xfc, 255);

  const cx = Math.floor(w / 2), cy = Math.floor(h / 2);
  const outerR = Math.floor(w * 0.4);
  const thickness = Math.max(2, Math.floor(w * 0.06));
  const legThick = Math.max(1.5, Math.floor(w * 0.04));

  // White circle outline (draw filled white then smaller purple inside)
  drawCircle(pixels, w, h, cx, cy, outerR + Math.floor(thickness / 2), 255, 255, 255, 255);
  drawCircle(pixels, w, h, cx, cy, outerR - Math.floor(thickness / 2), 0x7c, 0x5c, 0xfc, 255);

  // Cross lines (spider web)
  const innerR = outerR - thickness;
  drawLine(pixels, w, h, cx - innerR, cy, cx - Math.floor(innerR * 0.2), cy, thickness, 255, 255, 255, 255);
  drawLine(pixels, w, h, cx + Math.floor(innerR * 0.2), cy, cx + innerR, cy, thickness, 255, 255, 255, 255);
  drawLine(pixels, w, h, cx, cy - innerR, cx, cy - Math.floor(innerR * 0.2), thickness, 255, 255, 255, 255);
  drawLine(pixels, w, h, cx, cy + Math.floor(innerR * 0.2), cx, cy + innerR, thickness, 255, 255, 255, 255);

  // Diagonal legs (only for larger icons)
  if (size >= 48) {
    const diagIn = Math.floor(innerR * 0.7);
    const diagOut = Math.floor(innerR * 0.25);
    drawLine(pixels, w, h, cx - diagIn, cy - diagIn, cx - diagOut, cy - diagOut, legThick, 255, 255, 255, 255);
    drawLine(pixels, w, h, cx + diagIn, cy - diagIn, cx + diagOut, cy - diagOut, legThick, 255, 255, 255, 255);
    drawLine(pixels, w, h, cx - diagIn, cy + diagIn, cx - diagOut, cy + diagOut, legThick, 255, 255, 255, 255);
    drawLine(pixels, w, h, cx + diagIn, cy + diagIn, cx + diagOut, cy + diagOut, legThick, 255, 255, 255, 255);
  }

  return encodePNG(w, h, pixels);
}

// ---- Main ----
const sizes = [16, 32, 48, 128];
for (const size of sizes) {
  const png = generateIcon(size);
  const filePath = path.join(ICONS_DIR, `icon-${size}.png`);
  fs.writeFileSync(filePath, png);
  console.log(`✓ icon-${size}.png (${png.length} bytes)`);
}

console.log('\nAll icons generated!');
