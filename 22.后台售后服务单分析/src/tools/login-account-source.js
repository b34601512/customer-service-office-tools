#!/usr/bin/env node
// 账号来源（22号 各平台登录自动填充共用）：按「平台 + 店 key」从 9号（主）/12号（补充）的
// project-config/platform-config.json 里**只读**取账号密码；22号 自己不再存一份。
//
// 为什么：用户 2026-09-30 明确「可以从其他项目复制过去账号密码」，且「不需要重新写脚本，看别的项目怎么自动化登录的」。
// ⚠️ 用户当场纠正（2026-09-30）：「你填的啥，完全不对，跟隔壁的都不一样」——天猫/拼多多子账号的登录名
//    就是**整串「主账号:子账号」**（如 德达旗舰店:小黛），必须原样填，不许 split(':') 取一半。
// ⚠️ 找不到店 key 必须报错：**不拿别家店的账号顶替**（串店=事故）。
const 账号配置来源 = [
  { 来源: "9号", 路径: "D:/桌面/办公软件/9.客服数据自动更新/project-config/platform-config.json" },
  { 来源: "12号", 路径: "D:/桌面/办公软件/12.店铺指标数据自动更新/project-config/platform-config.json" },
];

// 纯函数，可单测：来源列表默认从 9号/12号 配置读；单测里可注入假配置。
// 账密来源配置（fixture）：[{ 来源, 配置: { [platform]: { stores: [...] } } }]
function 读账号(platform, accountKey, 来源列表) {
  const 列表 = 来源列表 || 账号配置来源.map((项) => ({ 来源: 项.来源, 配置: require(项.路径) }));
  let 找到店但没账密 = false;
  for (const 项 of 列表) {
    const 店铺 = ((项.配置[platform] || {}).stores) || [];
    const 命中 = 店铺.find((s) => s.key === accountKey);
    if (!命中) continue;
    const 账号 = String(命中.username || 命中.account || "").trim();
    const 密码 = String(命中.password || "").trim();
    if (!账号 || !密码) { 找到店但没账密 = true; continue; } // 这家没存账密（如 9号的 pdd03）→ 继续看下一家
    return { 账号, 密码, 来源: `${项.来源}配置的 ${accountKey}` };
  }
  if (找到店但没账密) throw new Error(`配置里 ${platform}/${accountKey} 的账号或密码为空（9号/12号 里找到店但没账密，请人工确认）`);
  throw new Error(`9号/12号配置里都没有 ${platform}/${accountKey}：不拿别家店的账号顶替，请人工确认`);
}

module.exports = { 账号配置来源, 读账号 };

if (require.main === module) {
  // 自查用：node src/tools/login-account-source.js tmall tmall1
  const [, , platform = "tmall", key = "tmall1"] = process.argv;
  const r = 读账号(platform, key);
  console.log(`${platform}/${key} ← ${r.来源}｜账号 ${r.账号.slice(0, 3)}***（整串：主账号:子账号，含冒号=${r.账号.includes(":")}）｜密码长度 ${r.密码.length}`);
}
