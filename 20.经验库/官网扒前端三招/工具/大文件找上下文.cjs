// 大文件里按关键词找「上下文」——别用 grep -P 扫几百 MB 的二进制（会卡死）
// 原理：整块读入，Buffer.indexOf 找偏移，slice 出前后文；快、稳、跨平台。
//
// 用法：node 大文件找上下文.cjs <文件> <关键词> [前置字节=200] [后置字节=400] [--unicode]
//   --unicode：把周围的 \uXXXX 转义解码成中文（Electron 的 i18n 里很常见）
const fs = require("node:fs");

const [文件, 关键词] = process.argv.slice(2, 4);
const 前 = parseInt(process.argv[4] || "200", 10);
const 后 = parseInt(process.argv[5] || "400", 10);
const 解码 = process.argv.includes("--unicode");

if (!文件 || !关键词) {
  console.log("用法：node 大文件找上下文.cjs <文件> <关键词> [前置字节=200] [后置字节=400] [--unicode]");
  process.exit(1);
}

const buf = fs.readFileSync(文件);
const 针 = Buffer.from(关键词, "utf8");
let i = 0;
let 次 = 0;
while ((i = buf.indexOf(针, i)) !== -1) {
  次 += 1;
  let 文 = buf.slice(Math.max(0, i - 前), i + 针.length + 后).toString("utf8");
  if (解码) {
    文 = 文.replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
  }
  文 = 文.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "·");
  console.log(`── 第 ${次} 处 @偏移 ${i} ──`);
  console.log(文);
  i += 针.length;
}
console.log(`共 ${次} 处（文件 ${buf.length} 字节）`);
