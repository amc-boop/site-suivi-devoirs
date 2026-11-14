// Génère les icônes PNG de l'appli (sans dépendance) : node scripts/make-icons.mjs
import zlib from 'node:zlib';
import fs from 'node:fs';

function crc32(buf) { let c, crc = ~0; for (const b of buf) { c = (crc ^ b) & 0xff; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crc = (crc >>> 8) ^ c; } return ~crc >>> 0; }
const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td)); return Buffer.concat([len, td, crc]); };
const distSeg = (px, py, ax, ay, bx, by) => { const dx = bx - ax, dy = by - ay; const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy))); return Math.hypot(px - ax - t * dx, py - ay - t * dy); };

function icon(size) {
  const s = size / 512, raw = Buffer.alloc(size * (size * 3 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 3 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const X = x / s, Y = y / s;
      let c = [22, 22, 22];
      const ang = Math.atan2(Y - 256, X - 256);
      if (Math.abs(Math.sin(ang * 9)) < 0.05 && Math.hypot(X - 256, Y - 256) > 170) c = [80, 80, 80];
      const inBox = X > 136 && X < 376 && Y > 136 && Y < 376;
      const inInner = X > 152 && X < 360 && Y > 152 && Y < 360;
      if (inBox) c = [22, 22, 22];
      if (inInner) c = [255, 255, 255];
      const d = Math.min(distSeg(X, Y, 186, 262, 238, 314), distSeg(X, Y, 238, 314, 330, 204));
      if (d < 17) c = [214, 40, 57];
      raw.set(c, y * (size * 3 + 1) + 1 + x * 3);
    }
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
for (const n of [192, 512]) fs.writeFileSync(new URL(`../client/public/icon-${n}.png`, import.meta.url), icon(n));
console.log('Icônes générées');
