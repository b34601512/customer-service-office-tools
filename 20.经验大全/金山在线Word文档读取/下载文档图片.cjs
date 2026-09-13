// 配套脚本：把金山文档（Word/表格皆可）里的嵌入图片下载到本机
//
// 干什么：读「金山在线Word文档读取.cjs」产出的 online-pics.json（图片节点的 attrs.sourceKey），
//         在已打开文档的页面里调 /attachment/shapes 换临时签名地址，再把图片下载到本地。
//         需要看截图里的内容（培训文档、图片版教程）时用；只要正文不必跑这个。
//
// 用法：
//   set NODE_PATH=D:\桌面\办公软件\1.客服超时督办\node_modules
//   node "下载文档图片.cjs" --share-id 分享ID --pics online-pics.json --out "输出目录"
//   node "下载文档图片.cjs" --url "https://www.kdocs.cn/l/xxxx" --pics online-pics.json --out . --limit 3
//
// 只读：不写入在线文档；不保存、不打印 Cookie / 登录态；签名地址只在内存里用完即弃。
// 输出的 pic-urls.json 含临时签名 URL（有时效），按经验不要当永久数据源、不要入库。
const { chromium } = require("playwright-core");
const fs = require("fs");
const path = require("path");

function parseArgs(argv) {
  const out = { profile: "C:/Users/" + (process.env.USERNAME || "user") + "/.pi-edge-auto", maxEdge: 2000, pics: "online-pics.json", out: "." };
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i];
    if (!key.startsWith("--")) continue;
    const value = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : "true";
    const name = key.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    out[name] = /^(limit|maxEdge)$/.test(name) ? Number(value) : value;
  }
  return out;
}

(async () => {
  const args = parseArgs(process.argv.slice(2));
  const url = args.url || (args.shareId ? `https://www.kdocs.cn/l/${args.shareId}` : "");
  if (!url) throw new Error("需要 --url 或 --share-id");
  const shareId = args.shareId || url.split("/").pop();
  if (!fs.existsSync(args.pics)) throw new Error(`找不到图片清单：${args.pics}（先用 金山在线Word文档读取.cjs 生成 online-pics.json）`);

  const raw = JSON.parse(fs.readFileSync(args.pics, "utf8"));
  let keys = (Array.isArray(raw) ? raw : Object.keys(raw)).map((item) => (typeof item === "string" ? item : item.key)).filter(Boolean);
  if (args.limit) keys = keys.slice(0, args.limit);
  fs.mkdirSync(args.out, { recursive: true });
  console.log(`文档：${url}\n分享ID：${shareId}\n待下载：${keys.length} 张 → ${path.resolve(args.out)}`);

  const ctx = await chromium.launchPersistentContext(args.profile, { channel: "msedge", headless: true });
  try {
    const page = ctx.pages()[0] || (await ctx.newPage());
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(12000);   // 等文档登录态/接口就绪

    const result = await page.evaluate(async ({ shareId, keys, maxEdge }) => {
      const response = await fetch(`/api/v3/office/file/${shareId}/attachment/shapes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          objects: keys.map((attachment_id) => ({ attachment_id, max_edge: maxEdge, source: "" })),
          expire: 86400000,
          support_webp: false,
          with_thumbnail: true,
          support_lossless: true,
        }),
      });
      return response.json();
    }, { shareId, keys, maxEdge: args.maxEdge });

    fs.writeFileSync(path.join(args.out, "pic-urls.json"), JSON.stringify(result, null, 2));
    const data = result.data || {};
    let ok = 0;
    for (let i = 0; i < keys.length; i++) {
      const key = keys[i];
      const info = data[key] || {};
      const signed = info.raw || info.url;
      if (!signed) { console.log(`SKIP ${i + 1} ${key}`); continue; }
      const buffer = await (await page.request.get(signed)).body();
      const file = path.join(args.out, `pic-${String(i + 1).padStart(2, "0")}-${key}.png`);
      fs.writeFileSync(file, buffer);
      ok++;
      console.log(`OK ${path.basename(file)}  ${buffer.length} B`);
    }
    console.log(`完成：${ok}/${keys.length}`);
    console.log("验收：抽查几张图能正常打开，和文档里的位置对得上；pic-urls.json 里是临时签名地址，别外传、别入库。");
    if (ok !== keys.length) process.exitCode = 1;
  } finally {
    await ctx.close();
  }
})().catch((e) => { console.error(String(e && e.message ? e.message : e)); process.exit(1); });
