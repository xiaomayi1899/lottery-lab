#!/usr/bin/env node
/* 生成 PWA 图标：node scripts/make-icons.mjs */
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'icons');

function blend(px, i, r, g, b, a) {
  if (a <= 0) return;
  const inv = 1 - a;
  px[i] = px[i] * inv + r * a;
  px[i + 1] = px[i + 1] * inv + g * a;
  px[i + 2] = px[i + 2] * inv + b * a;
  px[i + 3] = 255;
}

function circle(px, R, cx, cy, rad, color, opts = {}) {
  const x0 = Math.max(0, Math.floor((cx - rad) * R));
  const x1 = Math.min(R - 1, Math.ceil((cx + rad) * R));
  const y0 = Math.max(0, Math.floor((cy - rad) * R));
  const y1 = Math.min(R - 1, Math.ceil((cy + rad) * R));
  const lx = cx - rad * 0.36, ly = cy - rad * 0.36;
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const dx = (x + 0.5) / R - cx;
      const dy = (y + 0.5) / R - cy;
      const d = Math.hypot(dx, dy);
      const cover = Math.min(1, Math.max(0, (rad - d) * R));
      if (!cover) continue;
      const q = Math.min(1, d / rad);
      const shade = 1 - 0.42 * q * q;
      const hl = Math.exp(-(Math.pow(dx - (lx - cx), 2) + Math.pow(dy - (ly - cy), 2)) / Math.pow(rad * 0.5, 2));
      const k = shade + hl * (opts.gloss == null ? 0.38 : opts.gloss);
      const i = (y * R + x) * 4;
      blend(px, i, Math.min(255, color[0] * k), Math.min(255, color[1] * k), Math.min(255, color[2] * k), cover);
    }
  }
}

function polyline(px, R, points, width, color) {
  const w = width * R;
  for (let s = 0; s < points.length - 1; s++) {
    const [ax, ay] = points[s];
    const [bx, by] = points[s + 1];
    const x0 = Math.max(0, Math.floor((Math.min(ax, bx) - width) * R));
    const x1 = Math.min(R - 1, Math.ceil((Math.max(ax, bx) + width) * R));
    const y0 = Math.max(0, Math.floor((Math.min(ay, by) - width) * R));
    const y1 = Math.min(R - 1, Math.ceil((Math.max(ay, by) + width) * R));
    const vx = bx - ax, vy = by - ay;
    const len2 = vx * vx + vy * vy || 1;
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const pxX = (x + 0.5) / R, pxY = (y + 0.5) / R;
        let t = ((pxX - ax) * vx + (pxY - ay) * vy) / len2;
        t = Math.max(0, Math.min(1, t));
        const dx = pxX - (ax + vx * t), dy = pxY - (ay + vy * t);
        const d = Math.hypot(dx, dy);
        const cover = Math.min(1, Math.max(0, (width / 2 - d) * R));
        if (!cover) continue;
        const i = (y * R + x) * 4;
        blend(px, i, color[0], color[1], color[2], cover);
      }
    }
  }
}

function render(size, ss) {
  const R = size * ss;
  const px = new Float32Array(R * R * 4);
  for (let y = 0; y < R; y++) {
    for (let x = 0; x < R; x++) {
      const i = (y * R + x) * 4;
      const u = x / R, v = y / R;
      let r = 18 - 12 * v, g = 27 - 19 * v, b = 52 - 38 * v;
      const g1 = Math.exp(-((Math.pow(u - 0.08, 2) + Math.pow(v + 0.02, 2)) / 0.10));
      const g2 = Math.exp(-((Math.pow(u - 0.96, 2) + Math.pow(v - 0.04, 2)) / 0.14));
      r += 46 * g1 + 2 * g2;
      g += 10 * g1 + 26 * g2;
      b += 14 * g1 + 62 * g2;
      const vig = 1 - 0.22 * Math.pow(Math.max(0, Math.hypot(u - 0.5, v - 0.5) - 0.32), 1.4) * 2.2;
      px[i] = Math.max(0, r * vig);
      px[i + 1] = Math.max(0, g * vig);
      px[i + 2] = Math.max(0, b * vig);
      px[i + 3] = 255;
    }
  }

  // 三个号码球
  circle(px, R, 0.395, 0.415, 0.176, [255, 96, 112], { gloss: 0.42 });
  circle(px, R, 0.635, 0.545, 0.127, [77, 163, 255], { gloss: 0.42 });
  circle(px, R, 0.285, 0.60, 0.086, [255, 196, 92], { gloss: 0.3 });

  // 底部走势折线
  polyline(px, R, [[0.16, 0.865], [0.33, 0.805], [0.50, 0.84], [0.68, 0.775], [0.855, 0.815]], 0.032, [255, 196, 92]);
  circle(px, R, 0.855, 0.815, 0.024, [255, 225, 160], { gloss: 0.1 });

  // 超采样降采样
  const out = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const i = (((y * ss + sy) * R) + (x * ss + sx)) * 4;
          r += px[i]; g += px[i + 1]; b += px[i + 2]; a += px[i + 3];
        }
      }
      const n = ss * ss;
      const o = (y * size + x) * 4;
      out[o] = Math.round(r / n);
      out[o + 1] = Math.round(g / n);
      out[o + 2] = Math.round(b / n);
      out[o + 3] = Math.round(a / n);
    }
  }
  return out;
}

const CRC_TABLE = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  CRC_TABLE[n] = c >>> 0;
}
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}
function encodePNG(size, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 6;   // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

mkdirSync(OUT, { recursive: true });
for (const size of [180, 192, 512]) {
  const ss = size <= 192 ? 4 : 2;
  const rgba = render(size, ss);
  const file = resolve(OUT, `icon-${size}.png`);
  writeFileSync(file, encodePNG(size, rgba));
  console.log(`[icons] ${file}`);
}
