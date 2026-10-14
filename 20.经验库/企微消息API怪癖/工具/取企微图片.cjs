#!/usr/bin/env node
"use strict";
/**
 * 取企微图片.cjs —— 企微媒体下载失败时的手动取图/解密小工具（只读，不打印密钥）
 *
 *   node 取企微图片.cjs --url "https://…" --aeskey "<43字符base64>" --out 图.png
 *   node 取企微图片.cjs --url "D:\本地\密文.bin" --aeskey "…" --out 图.png   # 本地文件（离线测试用）
 *   node 取企微图片.cjs --帮助
 *
 * 原理（实测）：企微媒体下载 URL 带签名（q-sign-time 约 5 分钟有效）；返回的是密文，
 *   解密＝AES-256-CBC；key = base64 解 aeskey（常 43+1 字符 → 32 字节）；IV = key 前 16 字节；
 *   明文带 PKCS#7 填充。去掉填充即原始文件（图片验头 ffd8 / PNG 验 89504e47）。
 *
 * 安全：不打印 aeskey；失败信息里也不含完整 key。
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ARGV = process.argv.slice(2);
if (!ARGV.length || ARGV.includes("--帮助") || ARGV.includes("--help")) {
  console.log([
    "用法：node 取企微图片.cjs --url <http(s)地址或本地文件> --aeskey <base64> --out <输出文件>",
    "  --url     企微 media.url（5 分钟时效，收到就取）",
    "  --aeskey  企微 media.aeskey（43+1 字符 base64）",
    "  --out     输出文件路径",
    "  --超时秒   下载超时（默认 30）",
    "",
    "注意：本工具只做「下载＋解密」，不负责从消息记录里抽字段。"
  ].join("\n"));
  process.exit(ARGV.length ? 0 : 2);
}
function 取值(名, 缺省) {
  const i = ARGV.indexOf(名);
  return i >= 0 && ARGV[i + 1] !== undefined ? ARGV[i + 1] : 缺省;
}
const url = 取值("--url");
const aeskey = 取值("--aeskey");
const 输出 = 取值("--out");
const 超时秒 = Number(取值("--超时秒", "30")) || 30;
if (!url || !aeskey || !输出) {
  console.error("缺少参数：--url / --aeskey / --out 三件套都要。");
  process.exit(2);
}

/** 解码 aeskey → 32 字节 key；兼容「43 字符缺 padding」与「44 字符带一个 =」两种写法 */
function 解key(aeskey) {
  let s = String(aeskey).trim().replace(/\s+/g, "");
  const buf = Buffer.from(s + "=".repeat((4 - (s.length % 4)) % 4), "base64");
  if (buf.length !== 32) throw new Error(`aeskey 解出来 ${buf.length} 字节（应为 32）——先确认字段没截断`);
  return buf;
}
function 解媒体(密文, aeskey) {
  const key = 解key(aeskey);
  const iv = key.slice(0, 16);
  const d = crypto.createDecipheriv("aes-256-cbc", key, iv);
  return Buffer.concat([d.update(密文), d.final()]);
}
async function 下载(url, 超时秒) {
  if (/^https?:\/\//i.test(url)) {
    const r = await fetch(url, { signal: AbortSignal.timeout(Math.max(1, 超时秒) * 1000) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return Buffer.from(await r.arrayBuffer());
  }
  return fs.readFileSync(url); // 本地文件（离线测试/已落盘密文）
}
function 验魔数(buf) {
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xd8) return "JPEG";
  if (buf.length >= 8 && buf.toString("hex", 0, 4) === "89504e47") return "PNG";
  if (buf.length >= 4 && buf.toString("hex", 0, 4) === "47494638") return "GIF";
  return null;
}

(async () => {
  try {
    const 密文 = await 下载(url, 超时秒);
    let 明文;
    try {
      明文 = 解媒体(密文, aeskey);
    } catch (e) {
      // 首次失败多为瞬时——自动重试一次（仅网络源）
      if (/^https?:\/\//i.test(url)) {
        console.error(`首次失败（${e.message}），自动重试一次…`);
        const 密文2 = await 下载(url, 超时秒);
        明文 = 解媒体(密文2, aeskey);
      } else throw e;
    }
    fs.mkdirSync(path.dirname(path.resolve(输出)), { recursive: true });
    fs.writeFileSync(输出, 明文);
    const 类型 = 验魔数(明文) || "未知类型";
    const sha = crypto.createHash("sha256").update(明文).digest("hex").slice(0, 16);
    console.log(`✅ 已保存：${path.resolve(输出)}（${类型}，${明文.length} 字节，sha256:${sha}…）`);
  } catch (e) {
    console.error(`❌ 取图失败：${e && e.message ? e.message : e}`);
    console.error("（检查：链接是否超过 5 分钟失效 / aeskey 是否抄全 / 网络或签名问题。先重试一次再说。）");
    process.exit(1);
  }
})();
