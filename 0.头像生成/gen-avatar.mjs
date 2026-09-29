#!/usr/bin/env node
/**
 * 木婉清 · 750×750 像素画生成器 —— 纯代码、零依赖（只用 Node 标准库）
 *
 * 一体成型：整张画只有一套 50×50 像素（×15 = 750）。人物是手绘像素图（只画左半边 25 列、
 * 程序镜像），肩胸一直画到画框底边，没有"小头像贴大背景"的接缝；夜空/月/远山/松影画在
 * 同一套像素上。PNG 由本文件手写编码（zlib + CRC32）。
 *
 * 用法：
 *   node gen-avatar.mjs                  # 750×750（+ 250×250 小图）
 *   node gen-avatar.mjs --size 250       # 边长，须是 50 的倍数
 *   node gen-avatar.mjs --preview        # 打印 50 行字符预览（调画用）
 */
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const N = 50;                              // 像素格边长（50 × 15 = 750）
const HERE = dirname(fileURLToPath(import.meta.url));

/* ================= 1. 色板 ================= */
const P = {
  K: '#221a2b',   // 描边 / 睫毛
  B: '#332a49',   // 眉
  D: '#241f31', d: '#3a3150', L: '#584a76',   // 发 暗/中/亮
  R: '#b8353f', r: '#7d1f2b',                 // 发带
  F: '#f8dcc0', S: '#f2c39b', s: '#cf9268',   // 肤 亮/中/暗
  x: '#ee9c88',                               // 腮红
  W: '#f7f2ea', E: '#22375a', e: '#4a6c9a', G: '#eef5ff',  // 眼白/瞳/瞳亮/眼神光
  M: '#9c4650', m: '#c06a72',                 // 唇
  C: '#e2ebee', c: '#a9c1c9', b: '#6d8b98',   // 衣 亮/中/领
  A: '#101b2e', AL: '#1c2c47',                // 松影
  g: '#3a2c3a', gl: '#584a5e',                // 剑柄
  o: '#c8a24a', ol: '#e3c46a',                // 金饰
  n: '#cbd6e0', nl: '#f0f5fa',                // 剑刃
};
const SKY = ['#0c1320', '#111a2b', '#162134', '#1d2a42', '#243350'];
const MOON = { core: '#f5eeda', edge: '#cfc7ae', glow: '#3a4d70' };
const RIDGE = { far: '#0b1220', near: '#05080f', mist: '#2b3d5c' };
const STAR = ['#93a8c9', '#dfe8f5'];
const FOG = '#46597b';

/* ================= 2. 手绘像素画（左半边 25 列 × 50 行，右半边镜像） ================= */
const LEFT = [
  '.........................',
  '.........................',
  '.........................',
  '.........................',
  '.........................',
  '...................LLLLLL',
  '.................LLdddddd',
  '...............LLdddddddd',
  '.............KddDDDDDDDDD',
  '............KDDDDDDDDDDDD',
  '...........KRRRRRRRRRRRRR',
  '...........Krrrrrrrrrrrrr',
  '...........KdDDDDDDDDDDDD',
  '...........KdDDDDDDDDDDDD',
  '...........KdDDDDDDDDDDDD',
  '...........KdDDDDDSSSSSSS',
  '...........KdDDDDSSSSSSSS',
  '...........KdDDDDSSSSSSSS',
  '...........KdDDDSSSSSSSSS',
  '...........KdDDDSSSSSSSSS',
  '...........KdDDDSSSSSSSSS',
  '...........KdDDDSSSBBBBSS',
  '...........KdDDDSSSSSSSSS',
  '...........KdDDDSKKKKKKSS',
  '...........KdDDDSSWEEEWSS',
  '...........KdDDDSSWGEeWSS',
  '...........KdDDDSSsssssSS',
  '...........KdDDDSSSSSSSSS',
  '...........KdDDDxxSSSSSSS',
  '...........KdDDDSSSSSSSss',
  '...........KdDDDSSSSSSSMM',
  '...........KdDDDSSSSSSSmm',
  '............KdDDDsSSSSSSS',
  '.............KdDDDsSSSSSS',
  '..............KdDDDDsSSSS',
  '...............KdDDDDDsSS',
  '................KdDDsssss',
  '.................KDdsssss',
  '................KDDCCCCCb',
  '...............KDDDCCCCbc',
  '..............KDDDDCCCbcc',
  '.............KDDDDDCCbccc',
  '............KDDDDDDCbcccc',
  '...........KDDDDDDDbCCCCC',
  '...........KDDDDDDDbCCCCC',
  '..........KcDDDDDDDbCCCCC',
  '.........KccDDDDDDDbCCCCC',
  '........KcccDDDDDDDCCCCCC',
  '.......KccccDDDDDDDCCCCCC',
  '......KcccccDDDDDDDCCCCCC',
];
/* 不对称小零件：发带飘带（右侧）、背剑（右侧）——镜像做不出来，单独落笔 */
const RIBBON = [[30, 12], [30, 13], [31, 14], [32, 15], [33, 16], [33, 17], [34, 18], [34, 19],
  [33, 20], [33, 21], [33, 22], [33, 23], [34, 24], [34, 25], [34, 26], [33, 27],
  [33, 28], [33, 29], [32, 30], [32, 31]];
const SWORD = [
  [42, 25, 'ol'], [43, 25, 'ol'], [44, 25, 'ol'],                            // 剑首
  [42, 26, 'o'], [43, 26, 'o'], [44, 26, 'o'],
  [42, 27, 'g'], [43, 27, 'g'], [44, 27, 'g'], [42, 28, 'g'], [43, 28, 'gl'],
  [44, 28, 'g'], [42, 29, 'g'], [43, 29, 'g'], [44, 29, 'g'], [42, 30, 'g'],
  [43, 30, 'gl'], [44, 30, 'g'], [42, 31, 'g'], [43, 31, 'g'], [44, 31, 'g'],
  [42, 32, 'g'], [43, 32, 'gl'], [44, 32, 'g'], [42, 33, 'g'], [43, 33, 'g'],
  [44, 33, 'g'], [42, 34, 'g'], [43, 34, 'g'], [44, 34, 'g'],                // 握柄（缠绳）
  [38, 35, 'o'], [39, 35, 'o'], [40, 35, 'ol'], [41, 35, 'o'], [42, 35, 'o'],
  [43, 35, 'o'], [44, 35, 'o'], [45, 35, 'ol'], [46, 35, 'o'], [47, 35, 'o'],
  [38, 36, 'o'], [39, 36, 'ol'], [40, 36, 'o'], [41, 36, 'o'], [42, 36, 'o'],
  [43, 36, 'o'], [44, 36, 'o'], [45, 36, 'o'], [46, 36, 'ol'], [47, 36, 'o'], // 护手
  [41, 37, 'n'], [42, 37, 'nl'], [40, 38, 'n'], [41, 38, 'n'], [42, 38, 'n'],
  [39, 39, 'n'], [40, 39, 'nl'], [41, 39, 'n'], [39, 40, 'n'], [40, 40, 'n'],
  [38, 41, 'n'], [39, 41, 'nl'], [38, 42, 'n'], [39, 42, 'n'],                // 剑身（往下没入肩后）
];

const hexToRgb = (hex) => [
  parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16),
];

/* ================= 3. 画布与画笔 ================= */
const buf = new Uint8Array(N * N * 3);
const mask = new Uint8Array(N * N);   // 人物遮罩：薄雾只上在人物之外
const put = (x, y, key) => {
  x = Math.round(x); y = Math.round(y);
  if (x < 0 || y < 0 || x >= N || y >= N) return;
  const [r, g, b] = hexToRgb(P[key] ?? key);
  const o = (y * N + x) * 3;
  buf[o] = r; buf[o + 1] = g; buf[o + 2] = b;
};
const BAYER = [[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]];
const dither = (x, y) => (BAYER[y & 3][x & 3] + 0.5) / 16;

/* ================= 4. 夜空 / 月 / 星 / 云 / 远山 ================= */
function paintSky() {
  const mx = 43, my = 10, mr = 4.6, glowR = 11;
  const ridgeFar = (x) => 37 + Math.round(3.2 * Math.sin(x / 6.5) + 2 * Math.sin(x / 2.7 + 1.2));
  const ridgeNear = (x) => 44 + Math.round(2.6 * Math.sin(x / 5.2 + 0.8) + 1.6 * Math.sin(x / 2.1 + 2.4));
  const cloudBand = (x, mid, base) => base + Math.round(1.2 * Math.sin(x / 4));

  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const v = (y / (N - 1)) * SKY.length;
      let hex = SKY[Math.min(SKY.length - 1, Math.max(0, Math.floor(v + dither(x, y))))];

      const dm = Math.hypot(x - mx, y - my);
      if (dm <= mr - 1.2) {
        hex = MOON.core;
        if (Math.hypot(x - (mx - 1.6), y - (my - 1.4)) < 1.1) hex = MOON.edge;   // 月面暗斑
        if (Math.hypot(x - (mx + 1.4), y - (my + 1.8)) < 1.2) hex = MOON.edge;
      } else if (dm <= mr) hex = MOON.edge;
      else if (dm <= glowR) {
        const t = 1 - (dm - mr) / (glowR - mr);
        if (t > dither(x, y)) hex = MOON.glow;
      }

      const h = (x * 37 + y * 91 + ((x * y) % 53)) % 97;
      if (dm > glowR && y < ridgeFar(x) - 2) {
        if (h === 3) hex = STAR[1];
        else if (h < 14) hex = STAR[0];
      }
      for (const [mid, base] of [[11, 7], [38, 22]]) {                            // 两抹薄云
        const cy = cloudBand(x, mid, base);
        const density = 0.7 * Math.exp(-(((x - mid) / 6) ** 2));
        if (y >= cy && y <= cy + 1 && dither(x, y) < density) hex = MOON.glow;
      }
      if (y >= ridgeNear(x)) hex = RIDGE.near;
      else if (y >= ridgeFar(x)) hex = RIDGE.far;
      else if (y === ridgeFar(x) - 1 && dither(x, y) < 0.3) hex = RIDGE.mist;

      put(x, y, hex);
    }
  }
}

/* ================= 5. 松影（左下角，配平右侧背剑） ================= */
function paintPine() {
  const ox = 1, oy = 39;
  const rows = [
    '.......A.......', '......AAA......', '.....AAAAA.....', '....AAAAAAA....',
    '......AAA......', '.....AAAAA.....', '......AAA......', '.....AAAAA.....',
    '....AAAAAAA....', '...AAAAAAAAA...',
  ];
  rows.forEach((row, dy) => {
    [...row].forEach((ch, dx) => {
      if (ch !== '.') put(ox + dx, oy + dy, dx < 6 ? 'AL' : 'A');
    });
  });
}

/* ================= 6. 人物：手绘左半边 → 镜像 → 叠不对称零件 ================= */
function paintFigure() {
  LEFT.forEach((row, y) => {
    if (row.length !== N / 2) throw new Error(`第 ${y} 行应是 ${N / 2} 字符，实际 ${row.length}`);
    [...row].forEach((ch, x) => {
      if (ch === '.') return;
      put(x, y, ch);
      put(N - 1 - x, y, ch);
      mask[y * N + x] = 1;
      mask[y * N + (N - 1 - x)] = 1;
    });
  });
  for (const [x, y, ch] of SWORD) {
    put(x, y, ch);
    mask[y * N + x] = 1;
  }
  RIBBON.forEach(([x, y], i) => {
    put(x, y, i % 4 === 3 ? 'r' : 'R');
    put(x + 1, y, 'r');
    mask[y * N + x] = 1;
    mask[y * N + x + 1] = 1;
  });
}

/* ================= 7. 收尾：底边薄雾、四角暗角 ================= */
function paintFog() {
  for (let y = 44; y < N; y++) {
    const p = Math.min(0.3, (y - 44) / 20);
    for (let x = 0; x < N; x++) {
      if (mask[y * N + x]) continue;
      if (dither(x, y) < p) put(x, y, FOG);
    }
  }
}
function vignette(startR = 27, maxP = 0.5) {
  const c = (N - 1) / 2;
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const dc = Math.hypot(x - c, y - c);
      if (dc <= startR) continue;
      if (dither(x, y) >= Math.min(maxP, (dc - startR) / 11)) continue;
      const o = (y * N + x) * 3;
      for (let k = 0; k < 3; k++) buf[o + k] = Math.round(buf[o + k] * 0.5);
    }
  }
}

/* ================= 8. 手写 PNG 编码（zlib + CRC32） ================= */
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
const crc32 = (b) => {
  let c = 0xffffffff;
  for (const byte of b) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
};
function encodePNG(w, h, rgba) {
  const stride = w * 4;
  const raw = Buffer.alloc((stride + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
function upscale(scale) {
  const w = N * scale;
  const rgba = Buffer.alloc(w * w * 4);
  for (let y = 0; y < w; y++) {
    const sy = (y / scale) | 0;
    for (let x = 0; x < w; x++) {
      const so = (sy * N + ((x / scale) | 0)) * 3;
      const to = (y * w + x) * 4;
      rgba[to] = buf[so]; rgba[to + 1] = buf[so + 1]; rgba[to + 2] = buf[so + 2]; rgba[to + 3] = 255;
    }
  }
  return rgba;
}

/* ================= 9. 出图 ================= */
const argv = process.argv.slice(2);
const getArg = (name, dflt) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt;
};
const out = resolve(process.cwd(), getArg('--out', 'avatar-muwanqing.png'));
const size = Number(getArg('--size', '750'));
if (!Number.isInteger(size) || size % N !== 0) throw new Error(`--size 必须是 ${N} 的倍数（750 / 250）`);

paintSky();
paintPine();
paintFigure();
paintFog();
vignette();

mkdirSync(dirname(out), { recursive: true });
const written = [];
for (const s of size === 750 ? [750, 250] : [size]) {
  const p = out.replace(/\.png$/i, `-${s}.png`);
  writeFileSync(p, encodePNG(s, s, upscale(s / N)));
  written.push(p);
}
if (argv.includes('--preview')) {
  const idx = new Map();
  const rows = [];
  for (let y = 0; y < N; y++) {
    let line = '';
    for (let x = 0; x < N; x++) {
      const o = (y * N + x) * 3;
      const key = `${buf[o]},${buf[o + 1]},${buf[o + 2]}`;
      if (!idx.has(key)) idx.set(key, String.fromCharCode(97 + idx.size));
      line += idx.get(key);
    }
    rows.push(line);
  }
  console.log(`\n预览（共 ${idx.size} 色）\n` + rows.join('\n'));
}
console.log(written.map((p) => `已出图 ${p}`).join('\n'));
