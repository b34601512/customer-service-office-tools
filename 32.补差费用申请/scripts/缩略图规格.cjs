#!/usr/bin/env node
// 32号 补差费用申请：缩略图规格 + 批量插图分组（2026-10-08.7 新增）。
//
// 为什么缩略图（黎路遥 2026-10-08 15:57 口径）：
//   「只需要一个缩略图用来打印就可以了……最好用原图缩，否则每个都看起来一样就太假了」
//   → 每张都从**该行自己的原图**在浏览器 canvas 里缩（不是占位图/同一张套用），
//     体积从 85~271KB 降到 ~10~25KB，整批 7 张 ~100KB → 一次请求带整批，绕开逐张触发的限流。
//
// 本模块只放**纯函数**（无 IO），让 导出收款码图.cjs / 写入在线表.cjs / 同步收款码图.cjs 共用，
// 并且能被 tests/收进回归测试。默认值就是任务口径：宽 320px、JPEG 质量 0.75、单张 ≤60KB、整批 ≤1MB。
//
// 失败一律抛错（不猜、不兜底、不自动重试平台请求）。
const 默认缩略参数 = Object.freeze({
  宽: 320,
  质量: 0.75,
  单张上限字节: 60 * 1024,
  整批上限字节: 1024 * 1024
});

// 缩略尺寸：不放大（原图比目标宽还小就保持原宽），高度按比例四舍五入。
//   算缩略尺寸(1279, 1744, 320) → { 宽: 320, 高: 436 }
//   算缩略尺寸(200, 100, 320)   → { 宽: 200, 高: 100 }（原图就小，不放大）
function 算缩略尺寸(原宽, 原高, 目标宽 = 默认缩略参数.宽) {
  const w = Number(原宽), h = Number(原高), tw = Number(目标宽);
  if (!Number.isFinite(tw) || tw <= 0) throw new Error(`缩略目标宽必须是正数：${目标宽}`);
  if (!Number.isFinite(w) || w <= 0) return { 宽: Math.round(tw), 高: 0 }; // 拿不到原宽：按目标宽，高未知
  const 出宽 = Math.min(w, tw);
  const 出高 = Number.isFinite(h) && h > 0 ? Math.max(1, Math.round((h * 出宽) / w)) : 0;
  return { 宽: Math.round(出宽), 高: Math.round(出高) };
}

// dataURL → 估算字节数（浏览器里降级阶梯用；Node 侧落盘后用 Buffer 精确算）
function 估字节(dataURL) {
  const s = String(dataURL == null ? "" : dataURL);
  const i = s.indexOf(",");
  if (i < 0) return 0;
  const b64 = s.slice(i + 1).replace(/\s+/g, "");
  let 补 = 0;
  if (b64.slice(-2) === "==") 补 = 2;
  else if (b64.slice(-1) === "=") 补 = 1;
  return Math.max(0, Math.floor((b64.length * 3) / 4) - 补);
}

// 体积守门：单张 ≤ 单张上限、整批合计 ≤ 整批上限。
//   结果 = 导出收款码图.cjs 的条目数组（每项 { 行, 字节, dataURL }）
//   返回 { 通过, 总字节, 失败: [{ 行, 字节, 原因 }] }
function 缩略体积守门(结果, 参数 = {}) {
  const 单张上限 = Number(参数.单张上限字节 || 默认缩略参数.单张上限字节);
  const 整批上限 = Number(参数.整批上限字节 || 默认缩略参数.整批上限字节);
  if (!(单张上限 > 0) || !(整批上限 > 0)) throw new Error("体积上限必须是正数");
  const 失败 = [];
  let 总字节 = 0;
  for (const x of 结果 || []) {
    if (!x) continue;
    const 字节 = Number.isFinite(Number(x.字节)) && Number(x.字节) >= 0 ? Number(x.字节) : 估字节(x.dataURL);
    总字节 += 字节;
    if (字节 > 单张上限) {
      失败.push({ 行: Number(x.行) || 0, 字节, 原因: `单张 ${字节} 字节 > 上限 ${单张上限} 字节（${Math.round(单张上限 / 1024)}KB）` });
    }
  }
  if (总字节 > 整批上限) {
    失败.push({ 行: 0, 字节: 总字节, 原因: `整批合计 ${总字节} 字节 > 上限 ${整批上限} 字节（${Math.round(整批上限 / 1024)}KB）` });
  }
  return { 通过: 失败.length === 0, 总字节, 失败 };
}

// 批量插图分组：每批 N 张 → [N, N, …, 余数]；每批 = 0/未给 → 整批一把 [总数]。
//   默认整批一把（2026-10-08.7）：缩略图整批 ~100KB，远低于官方 2M 正文上限，一次请求省得撞限流。
function 算批组(总数, 每批 = 0) {
  const n = Number(总数), size = Number(每批 == null || 每批 === "" ? 0 : 每批);
  if (!Number.isInteger(n) || n < 0) throw new Error(`总数必须是非负整数：${总数}`);
  if (!Number.isInteger(size) || size < 0) throw new Error(`--每批 必须是 ≥0 的整数（0=整批一把）：${每批}`);
  if (n === 0) return [];
  if (size === 0) return [n];
  const 组 = [];
  for (let i = 0; i < n; i += size) 组.push(Math.min(size, n - i));
  return 组;
}

module.exports = { 默认缩略参数, 算缩略尺寸, 估字节, 缩略体积守门, 算批组 };
