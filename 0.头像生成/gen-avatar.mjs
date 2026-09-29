#!/usr/bin/env node
/**
 * 木婉清 头像生成器 —— 纯代码、零依赖（只用 Node 标准库）
 *
 * 两种产物：
 *   ① 场景版（默认）：50×50 像素格 ×15 = 750×750。分层合成——夜空/月/星/远山 → 背剑、松影 → 头像剪影。
 *   ② 纯头像版：32×32 像素画（16 色板）→ 最近邻放大到 256。
 * PNG 由本文件手写编码（zlib + CRC32），不依赖任何图形库。
 *
 * 用法：
 *   node gen-avatar.mjs                    # 750×750 场景版 + 32/256 纯头像
 *   node gen-avatar.mjs --size 500         # 场景版边长（须是 50 的倍数）
 *   node gen-avatar.mjs --preview          # 额外打印场景版字符预览（50 行，调试用）
 *   node gen-avatar.mjs --out 目录/名.png   # 换输出名
 */
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SpringW = 32; // 头像像素画宽度
const Grid = 50;    // 场景版像素格（50 × 15 = 750）

/* ---------------- 1. 色板（16 色 + 场景用色） ---------------- */
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
  /* 场景色 */
  e: '#f0f5fa', // 剑·刃口高光
  n: '#cbd6e0', // 剑·刃
  N: '#7f8b99', // 剑·背光
  G: '#c8a24a', // 剑·护手
  P: '#e3c46a', // 剑·剑首
  g: '#3a2c3a', // 剑·握柄
  A: '#131e33', // 松影
};
const SKY = ['#0d1421', '#121b2c', '#182338', '#1f2c45']; // 夜空四阶（上暗下亮）
const MOON = { core: '#f5eeda', edge: '#cfc7ae', glow: '#3a4d70' };
const RIDGE = { far: '#0b1220', near: '#05080f' };
const CLOUD = '#2c3c5c';
const MIST = '#2b3d5c';
const STAR = ['#93a8c9', '#dfe8f5'];

/* ---------------- 2. 头像像素画：只写左半边 16 列，右半边镜像 ---------------- */
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
  '.....KdDDDDCCCbC',
  '....KDDdDDDCCbCC',
  '...KDDddDDDCbCCC',
  '..KDDddDDDDbCCCC',
  '.KDDddDDDDbCCCCC',
];

/* 叠加层：镜像做不出来的不对称小零件（发带飘带） */
const OVERLAY = [
  [26, 7, 'R'], [27, 7, 'r'], [27, 8, 'R'], [28, 8, 'r'],
  [28, 9, 'R'], [27, 10, 'r'], [28, 10, 'r'], [27, 11, 'r'],
];

function buildSprite() {
  const rows = LEFT.map((row, y) => {
    if (row.length !== SpringW / 2) throw new Error(`头像第 ${y} 行长度应为 ${SpringW / 2}，实际 ${row.length}`);
    return row + [...row].reverse().join('');
  });
  for (const [x, y, ch] of OVERLAY) {
    if (!PALETTE[ch]) throw new Error(`叠加层色号非法：${ch}`);
    rows[y] = rows[y].slice(0, x) + ch + rows[y].slice(x + 1);
  }
  return rows;
}

/* ---------------- 3. 场景零件 ---------------- */
// 背剑：剑首朝上、刃向左下（10×27，直接手绘，不旋转）
const SWORD = [
  '.....PP...',
  '.....gg...',
  '.....gg...',
  '.....gg...',
  '....gg....',
  '....gg....',
  '....gg....',
  '...gg.....',
  '..GGGGGG..',
  '...enN....',
  '...enN....',
  '...enN....',
  '..enN.....',
  '..enN.....',
  '..enN.....',
  '..enN.....',
  '.enN......',
  '.enN......',
  '.enN......',
  '.enN......',
  'enN.......',
  'enN.......',
  'enN.......',
  'enN.......',
  '.eN.......',
  '..N.......',
  '..........',
];
// 左下松影（12×15）
const PINE = [
  '.....A......',
  '....AAA.....',
  '...AAAAA....',
  '....AAA.....',
  '...AAAAA....',
  '..AAAAAAA...',
  '...AAAAA....',
  '..AAAAAAA...',
  '.AAAAAAAAA..',
  '..AAAAAAA...',
  '.AAAAAAAAA..',
  'AAAAAAAAAAA.',
  '.....A......',
  '.....A......',
  '....AAA.....',
];

const hexToRgb = (hex) => [
  parseInt(hex.slice(1, 3), 16),
  parseInt(hex.slice(3, 5), 16),
  parseInt(hex.slice(5, 7), 16),
];

/* 4×4 有序抖动（Bayer）：所有明暗过渡都靠它，保持 16bit 手绘感 */
const BAYER = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
];
const dither = (x, y) => (BAYER[y % 4][x % 4] + 0.5) / 16;

/* ---------------- 4. 合成：50×50 三阶背景 + 零件 + 头像 ---------------- */
function renderScene() {
  const buf = new Uint8Array(Grid * Grid * 3);
  const set = (x, y, hex) => {
    if (x < 0 || y < 0 || x >= Grid || y >= Grid) return;
    const [r, g, b] = typeof hex === 'string' ? hexToRgb(hex) : hex;
    const o = (y * Grid + x) * 3;
    buf[o] = r;
    buf[o + 1] = g;
    buf[o + 2] = b;
  };
  const get = (x, y) => {
    const o = (y * Grid + x) * 3;
    return [buf[o], buf[o + 1], buf[o + 2]];
  };

  const moonX = 35, moonY = 5, moonR = 4.2, glowR = 9;
  const farRidge = (x) => 33 + Math.round(3 * Math.sin(x / 6.5) + 2 * Math.sin(x / 2.7 + 1.2));
  const nearRidge = (x) => 41 + Math.round(2.5 * Math.sin(x / 5.2 + 0.8) + 1.5 * Math.sin(x / 2.1 + 2.4));

  /* ① 夜空：竖向渐变（抖动） + 月 + 月晕 + 星 + 远山 */
  for (let y = 0; y < Grid; y++) {
    for (let x = 0; x < Grid; x++) {
      // 渐变：上方最暗
      const v = (y / (Grid - 1)) * SKY.length;
      let skyHex = SKY[Math.min(SKY.length - 1, Math.max(0, Math.floor(v + dither(x, y))))];

      // 月与月晕
      const dm = Math.hypot(x - moonX, y - moonY);
      if (dm <= moonR - 1) skyHex = MOON.core;
      else if (dm <= moonR) skyHex = MOON.edge;
      else if (dm <= glowR) {
        const t = 1 - (dm - moonR) / (glowR - moonR);
        if (t > dither(x, y)) skyHex = MOON.glow; // 抖动做出柔和光晕
      }

      // 星点（只落在地平线以上的天空里，且避开月亮）
      const h = (x * 37 + y * 91 + ((x * y) % 53)) % 97;
      if (dm > glowR && y < farRidge(x) - 2) {
        if (h === 3) skyHex = STAR[1];
        else if (h < 12) skyHex = STAR[0];
      }

      // 左侧一抹薄云：中间密、两头疏，抖动出蓬松边
      const cloudMid = 8, cloudY = 5 + Math.round(0.6 * Math.sin(x / 3));
      const density = 0.8 * Math.exp(-(((x - cloudMid) / 5) ** 2));
      if (x >= 1 && x <= 17 && (y === cloudY || y === cloudY + 1) && dither(x, y) < density) {
        skyHex = CLOUD;
      }

      // 山脊线上一条薄雾（拉开远山与头发的层次）
      if (y === farRidge(x) - 1 && dither(x, y) < 0.35) skyHex = MIST;

      // 远山两重
      if (y >= nearRidge(x)) skyHex = RIDGE.near;
      else if (y >= farRidge(x)) skyHex = RIDGE.far;

      set(x, y, skyHex);
    }
  }

  /* ② 零件：背剑（右）、松影（左下） */
  const stamp = (sprite, ox, oy) => {
    sprite.forEach((row, dy) => {
      [...row].forEach((ch, dx) => {
        if (ch === '.') return;
        const hex = PALETTE[ch];
        if (!hex) throw new Error(`零件色号非法：${ch}`);
        set(ox + dx, oy + dy, hex);
      });
    });
  };
  stamp(SWORD, 39, 16); // 剑首在右肩外侧，刃向下、隐入身后
  stamp(PINE, 1, 35);   // 左下松影，和右侧背剑配平

  /* ③ 头像：32×32 贴在正中（50-32)/2 = 9），剪影以外透明、露出背景 */
  const sprite = buildSprite();
  const ox = Math.floor((Grid - SpringW) / 2);
  sprite.forEach((row, y) => {
    [...row].forEach((ch, x) => {
      if (ch === '.') return;
      const hex = PALETTE[ch];
      if (!hex) throw new Error(`未知色号「${ch}」于 (${x},${y})`);
      set(ox + x, ox + y, hex);
    });
  });

  return { buf, set, get };
}

/* 暗角：只压四角，中心（脸）不受影响，抖动叠加保持手绘感 */
function vignette(buf, startR = 26, maxP = 0.55) {
  const c = (Grid - 1) / 2;
  for (let y = 0; y < Grid; y++) {
    for (let x = 0; x < Grid; x++) {
      const dc = Math.hypot(x - c, y - c);
      if (dc <= startR) continue;
      const p = Math.min(maxP, (dc - startR) / 14);
      if (dither(x, y) >= p) continue;
      const o = (y * Grid + x) * 3;
      for (let k = 0; k < 3; k++) buf[o + k] = Math.round(buf[o + k] * 0.45);
    }
  }
  return buf;
}

/* ---------------- 5. 手写 PNG 编码（zlib 压缩 + CRC32，无第三方库） ---------------- */
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

/* ---------------- 6. 最近邻放大 ---------------- */
function upscaleRGB(src, srcW, srcH, scale) {
  const w = srcW * scale;
  const h = srcH * scale;
  const rgba = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) {
    const sy = Math.floor(y / scale);
    for (let x = 0; x < w; x++) {
      const sx = Math.floor(x / scale);
      const so = (sy * srcW + sx) * 3;
      const to = (y * w + x) * 4;
      rgba[to] = src[so];
      rgba[to + 1] = src[so + 1];
      rgba[to + 2] = src[so + 2];
      rgba[to + 3] = 255;
    }
  }
  return rgba;
}

/* ---------------- 7. 命令行 ---------------- */
const argv = process.argv.slice(2);
const getArg = (name, dflt) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt;
};
const out = resolve(process.cwd(), getArg('--out', 'avatar-muwanqing.png'));
const sceneSize = Number(getArg('--size', String(Grid * 15)));
if (sceneSize % Grid !== 0) throw new Error(`--size 必须是 ${Grid} 的倍数（如 750、500、1000）`);
const sceneScale = sceneSize / Grid;

const { buf } = renderScene();
vignette(buf);
mkdirSync(dirname(out), { recursive: true });
const scenePath = out.replace(/\.png$/i, `-${sceneSize}.png`);
writeFileSync(scenePath, encodePNG(sceneSize, sceneSize, upscaleRGB(buf, Grid, Grid, sceneScale)));

// 纯头像版：32×32 原图 + 256 放大
const sprite = buildSprite();
const bare = new Uint8Array(SpringW * SpringW * 3);
for (let y = 0; y < SpringW; y++) {
  for (let x = 0; x < SpringW; x++) {
    const ch = sprite[y][x];
    const rgb = ch === '.' ? [21, 28, 43] : hexToRgb(PALETTE[ch]); // 透明处填深蓝底
    const o = (y * SpringW + x) * 3;
    bare[o] = rgb[0];
    bare[o + 1] = rgb[1];
    bare[o + 2] = rgb[2];
  }
}
writeFileSync(out, encodePNG(SpringW, SpringW, upscaleRGB(bare, SpringW, SpringW, 1)));
const bigPath = out.replace(/\.png$/i, `-${SpringW * 8}.png`);
writeFileSync(bigPath, encodePNG(SpringW * 8, SpringW * 8, upscaleRGB(bare, SpringW, SpringW, 8)));

if (argv.includes('--preview')) {
  const legend = 'K轮廓 D/d/L发 R/r发带 F/S/s肤 W/E眼 M唇 C衣 b领 · 剑ennNGPg 松A';
  console.log(`\n色板：${legend}\n`);
  const chars = [];
  for (let y = 0; y < Grid; y++) {
    let line = '';
    for (let x = 0; x < Grid; x++) {
      const o = (y * Grid + x) * 3;
      const rgb = [buf[o], buf[o + 1], buf[o + 2]].join(',');
      line += chars.includes(rgb) ? '·' : String.fromCharCode(97 + chars.push(rgb) - 1);
    }
    console.log(line);
  }
}

console.log(`\n场景版（${sceneSize}×${sceneSize}，${Grid} 格 ×${sceneScale}）：${scenePath}`);
console.log(`纯头像 ${SpringW}×${SpringW}：${out}`);
console.log(`纯头像 ×8（${SpringW * 8}×${SpringW * 8}）：${bigPath}`);
