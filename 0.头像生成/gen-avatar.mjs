#!/usr/bin/env node
/**
 * 木婉清 头像生成器 —— 纯代码、零依赖（只用 Node 标准库）
 *
 * 思路：手写 32×32 像素画（16 色板，SNES 时代风格）→ 最近邻放大 → 手写 PNG 编码（zlib + CRC32）。
 * 用法：
 *   node gen-avatar.mjs                        # 出 256×256（scale=8）+ 32×32 原图
 *   node gen-avatar.mjs --scale 16 --out a.png # 自定义放大倍数与文件名
 *   node gen-avatar.mjs --no-preview           # 不打印终端字符预览
 */
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const W = 32;
const H = 32;

/* ---------------- 1. 16 色板 ---------------- */
const PALETTE = {
  K: '#14121f', // 轮廓（最暗）
  D: '#2b2438', // 发·暗
  d: '#463a5a', // 发·中
  L: '#6b5a82', // 发·亮（顶部受光）
  R: '#b8353f', // 发带·红
  r: '#7d1f2b', // 发带·暗红
  S: '#edb98f', // 肤·中
  s: '#c98a63', // 肤·暗
  F: '#f9dcc0', // 肤·亮
  E: '#2a3b5c', // 眼·瞳
  W: '#f2f6ff', // 眼白
  M: '#a4505a', // 唇
  C: '#dfe9ec', // 衣·亮（青白汉服）
  b: '#6d8b98', // 衣·暗（衣领）
};
const BG = ['#151c2b', '#1e2839', '#2b3a52']; // 背景三阶：远暗近亮，脑后一圈微光

/* ---------------- 2. 像素画：只写左半边 16 列，右半边镜像 ---------------- */
const LEFT = [
  '................',
  '................',
  '.........LLLLLLL',
  '........Lddddddd',
  '.......KdDDDDDDD',
  '......KDDDDDDDDD',
  '......KRRRRRRRRR',
  '.....KRRRRRRRRRR',
  '.....KDDDDDDDDDD',
  '.....KDDDDDDDDDD',
  '.....KDDDFFFFFFF',
  '.....KDDDFssssFF',
  '.....KddDFFWEEFF',
  '.....KddDFFWEEFF',
  '.....KddDSSSSSSS',
  '.....KdDDSSSSSSs',
  '.....KDDDSSSSSSs',
  '.....KDDDSSSSSSS',
  '.....KDDDSSSSSSM',
  '.....KDDDSSSSSSS',
  '.....KDDDSSSSSSS',
  '......KDDDsSSSSS',
  '.......KDDDsSSSS',
  '........KDDDsSSS',
  '........KDDDssSS',
  '.......KDDDDssss',
  '......KDDDDCCCCb',
  '.....KDDDDDCCCbC',
  '....KDDdDDDCCbCC',
  '...KDDddDDDCbCCC',
  '..KDDddDDDDbCCCC',
  '.KDDddDDDDbCCCCC',
];

/* ---------------- 2b. 叠加层：不对称的小零件（发带飘带），镜像做不出来 ---------------- */
const OVERLAY = [
  [26, 7, 'R'],
  [27, 7, 'r'],
  [27, 8, 'R'],
  [28, 8, 'r'],
  [28, 9, 'R'],
  [27, 10, 'r'],
  [28, 10, 'r'],
  [27, 11, 'r'],
];

function buildSprite() {
  const rows = LEFT.map((row, y) => {
    if (row.length !== W / 2) throw new Error(`第 ${y} 行长度应为 ${W / 2}，实际 ${row.length}`);
    return row + [...row].reverse().join('');
  });
  for (const [x, y, ch] of OVERLAY) {
    if (!PALETTE[ch]) throw new Error(`叠加层色号非法：${ch}`);
    rows[y] = rows[y].slice(0, x) + ch + rows[y].slice(x + 1);
  }
  return rows;
}

/* ---------------- 3. 背景：4×4 有序抖动（Bayer）画脑后微光 ---------------- */
const BAYER = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
];
const hexToRgb = (hex) => [
  parseInt(hex.slice(1, 3), 16),
  parseInt(hex.slice(3, 5), 16),
  parseInt(hex.slice(5, 7), 16),
];

function renderRGBA() {
  const sprite = buildSprite();
  const buf = Buffer.alloc(W * H * 4);
  const bgRGB = BG.map(hexToRgb);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const ch = sprite[y][x];
      let rgb;
      if (ch === '.') {
        // 离头部中心越近越亮；用抖动在两档之间过渡，得到像素风的光晕
        const d = Math.hypot(x - 15.5, y - 14);
        const v = Math.max(0, 1 - d / 15) * BG.length;
        const t = (BAYER[y % 4][x % 4] + 0.5) / 16;
        const idx = Math.min(BG.length - 1, Math.max(0, Math.floor(v + t)));
        rgb = bgRGB[idx];
      } else {
        const hex = PALETTE[ch];
        if (!hex) throw new Error(`未知色号「${ch}」于 (${x},${y})`);
        rgb = hexToRgb(hex);
      }
      const o = (y * W + x) * 4;
      buf[o] = rgb[0];
      buf[o + 1] = rgb[1];
      buf[o + 2] = rgb[2];
      buf[o + 3] = 255;
    }
  }
  return buf;
}

/* ---------------- 4. 手写 PNG 编码（zlib 压缩 + CRC32，无第三方库） ---------------- */
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

function encodePNG(w, h, rgba) {
  const stride = w * 4;
  const raw = Buffer.alloc((stride + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (stride + 1)] = 0; // 过滤器：None
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // 位深
  ihdr[9] = 6; // 颜色类型：RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

/* ---------------- 5. 最近邻放大 ---------------- */
function upscale(rgba, scale) {
  if (scale === 1) return rgba;
  const w = W * scale;
  const h = H * scale;
  const out = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) {
    const sy = Math.floor(y / scale);
    for (let x = 0; x < w; x++) {
      const sx = Math.floor(x / scale);
      const so = (sy * W + sx) * 4;
      const to = (y * w + x) * 4;
      out[to] = rgba[so];
      out[to + 1] = rgba[so + 1];
      out[to + 2] = rgba[so + 2];
      out[to + 3] = 255;
    }
  }
  return out;
}

/* ---------------- 6. 命令行 ---------------- */
const argv = process.argv.slice(2);
const getArg = (name, dflt) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt;
};
const scale = Number(getArg('--scale', '8'));
const out = resolve(process.cwd(), getArg('--out', 'avatar-muwanqing.png'));
if (!Number.isInteger(scale) || scale < 1) throw new Error('--scale 必须是正整数');

const rgba = renderRGBA();
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, encodePNG(W, H, rgba));
const bigPath = out.replace(/\.png$/i, `-${W * scale}.png`);
writeFileSync(bigPath, encodePNG(W * scale, H * scale, upscale(rgba, scale)));

if (!argv.includes('--no-preview')) {
  const legend = 'K轮廓 D/d/L发 R/r发带 F/S/s肤 W/E眼 M唇 C衣 b领 .背景';
  console.log(`\n色板：${legend}\n`);
  console.log(buildSprite().map((r) => r.replace(/\./g, ' ')).join('\n'));
}

console.log(`\n原图 ${W}×${H}：${out}`);
console.log(`放大 ×${scale}（${W * scale}×${H * scale}）：${bigPath}`);
