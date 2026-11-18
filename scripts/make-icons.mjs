// Dependency-free PNG icons for the PWA manifest: a night sea, a headland, a sail.
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
};

function png(size) {
  const px = Buffer.alloc(size * size * 4);
  const set = (x, y, r, g, b) => {
    const i = (y * size + x) * 4;
    px[i] = r; px[i + 1] = g; px[i + 2] = b; px[i + 3] = 255;
  };
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const v = y / size;
      let r = 16, g = 32, b = 47; // night sea
      if (v > 0.62 + 0.08 * Math.sin(u * 7)) { r = 58; g = 92; b = 54; }           // headland
      if (v > 0.9) { r = 40; g = 66; b = 40; }                                      // shore shadow
      const sx = u - 0.62, sy = v - 0.3;
      if (sx * sx + sy * sy < 0.05 * 0.05 + 0.09) { /* sun glow */ }
      if (sx * sx * 2.2 + sy * sy < 0.09) { r = 232; g = 190; b = 90; }            // sun
      if (v < 0.6 && v > 0.24 && Math.abs(u - 0.34) < (0.6 - v) * 0.32 + 0.03 && (v - 0.24) * 0.9 > Math.abs(u - 0.34) * 0.45) {
        r = 226; g = 220; b = 200;                                                 // sail
      }
      if (v > 0.56 && v < 0.64 && Math.abs(u - 0.36) < 0.16) { r = 74; g = 56; b = 38; } // hull
      const rad = size * 0.16; // rounded corners
      const corner = (cx, cy) => (x - cx) ** 2 + (y - cy) ** 2 > rad * rad;
      if (corner(0, 0) && x < rad && y < rad || corner(size, 0) && x > size - rad && y < rad ||
          corner(0, size) && x < rad && y > size - rad || corner(size, size) && x > size - rad && y > size - rad) {
        set(x, y, 0, 0, 0);
        px[(y * size + x) * 4 + 3] = 0;
        continue;
      }
      set(x, y, r, g, b);
    }
  }
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    px.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const dir = resolve(import.meta.dirname, '../public');
mkdirSync(dir, { recursive: true });
writeFileSync(resolve(dir, 'icon-192.png'), png(192));
writeFileSync(resolve(dir, 'icon-512.png'), png(512));
writeFileSync(resolve(dir, 'apple-touch-icon.png'), png(180));
console.log('icons written');
