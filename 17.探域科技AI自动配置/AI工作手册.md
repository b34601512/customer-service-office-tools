# 探域科技 AI 配置 · AI 工作手册(给后续 AI 看)

> 目标: 德达医疗旗舰店(拼多多)客服机器人自动回复。先读本手册 + `README.md` + `审核报告.md`，再读增量经验 `经验沉淀-2026-09-04.md`，不要重新摸索。

## 0. 铁律
- 独立浏览器画像固定用 `C:/Users/b3460/.pi-edge-auto`；按用户要求统一 `headless:true`，不拉起可见窗口，登录态只存本机。
- 不要动用户原来的 Edge(端口 9222 那个不是 CDP, 接管不了, 别试了)。
- 不可逆操作(删卡/改配置)先列清单, 用户说过"全部砍"才批量执行; 价格/承诺类一律转人工, 不擅自留。
- Cookie 只存本机脚本, 不发云端。

## 1. 独立浏览器(标准起手式)
```js
const { chromium } = require('playwright-core'); // 需 playwright-core@1.62.1
const ctx = await chromium.launchPersistentContext('C:/Users/b3460/.pi-edge-auto', {
  channel: 'msedge', headless: true, viewport: { width: 1600, height: 1000 } });
const page = ctx.pages()[0] || await ctx.newPage();
// 默认打开知识库配置页, 不要用 /v2/dashboard(那是数据罗盘, 不是配置页)
await page.goto('http://agent.tanyuai.com/v2/agent-builder/knowledge-base', { waitUntil: 'domcontentloaded' }).catch(()=>{});
await page.waitForTimeout(8000);
```
- 首次无登录态时停止并告知用户先准备已登录画像；脚本不自动扫码/登录，也不输出凭证。
- 所有接口调用都用 `page.evaluate(fetch...)` + `credentials:'include'` 携带登录态。

## 2. Cookie 直调(轻量查询, 不开浏览器也行)
```
Cookie: tanyu-group-id=2094743970688012288; tanyu-agent-account=o3_sou0z2ywnjz81Z_477qHepA8qC4HsEG__; tanyu-account-id=2094743970688012288
```
- 店铺: 德达医疗旗舰店, groupId=2094743970688012288, thirdShopId=2095398963959042048, chatbotShopId=2095399454105407488, platform=1(拼多多), sellerId=706231158。
- 绑定客服: 小黛/德德/嘟嘟/璇璇; 策略: 全自动 + 智能体优先(防抢话)。

## 3. 知识库接口(核心, 都在页面 fetch 里调)
| 操作 | 接口 | 要点 |
|---|---|---|
| 查总数/全拉 | POST `/api/kbe/v1/knowledge-card/page` `{pageNo:1,pageSize:3000}` | 必须 pageSize:3000 一次拉全; pageSize:500 翻页会重复 id; 返回 `data.total` 经常是**过期缓存**, 以 `results.length` 为准; UI 搜索框搜多字要先点"重置"(翻页游标 bug 会吞结果), 单字无索引搜不到 |
| 逐条新增 | POST `/api/kbe/v1/knowledge-card/save` `{title,content:[{content}],labels:[],ifBelievable:true,type:'SHOP',ifOpen:true}` | batch-create/batch-save/import 都是 405, 只能逐条, 并发 4; **类型字段是 `type` 不是 `knowledgeType`(传后者会被静默忽略, 全掉进商品知识)**; 内容必须 QA 格式 `Q:问题\nA:回答`(标题只给人看, 不参与话术生成); 每分段 ≤300 字, 。！ 会自动分段发出 |
| 带 id 保存=原位更新 | `/update` 同上 + `id` 字段 | 已验证: 不会产生重复卡; **转全店用 `type:'SHOP'`**, 转后不可逆; 批量删前先全量备份正文(只备 200 字不够用) |
| 删除 | POST `/api/kbe/v1/knowledge-card/batch-delete` `{cardIds:[]}` | 每次 ≤50 个 id 分批; 成功返回 `{"code":1,"msg":"操作成功!"}` |
| 三问模拟 | 前端模拟器(见 `simtest.cjs`) | 改完知识后必跑: 价格/功效/售后各一问 |

- 卡结构坑: `title` 经常为 null(商品页学来的无标题卡), 正文在 `content[].content` 里; 删卡先按**内容片段 grep 定位 id**, 不要按 title 猜。
- 无标题长卡(>500 字)多是商品详情重复表, 用 `dedup.cjs`(双字 bigram Jaccard≥0.45 聚类, 每簇留最长)去重。

## 4. 改配置(接待/策略页, 用 Playwright 控件操作，不用 GUI)
- 见 `stratfull.cjs`(4 客服全选+全自动+全店+保存) / `stratverify.cjs`(复查持久化) / `racefix.cjs`(点 `label:has-text("智能体优先")`, 点完 radio 会变 `[false,true]`, 属正常)。
- 改完必须截图存 `证据截图/`, 并用 verify 脚本复查落盘。

## 5. 官方文档
- 飞书《智能体2026新页面后台(实施版)操作文档》: `https://my.feishu.cn/wiki/IANhwhmQCio7cxkBdBacnVK5nBh`，密码由用户保管，不写入复用笔记。
- 四步主干: survey(现状)→auth(授权)→knowledge(知识)→enable(เปิด接待)→verify(验证)。店铺授权 `auths=[]` 仍是空的, 后续需补。

## 6. 话术导入与审核(已做完一轮, 流程保留)
1. 解析 `话术源文件.xls`(Sheet1, 1586 行)→ `hs-all.json` → `hsbatch.cjs` 逐条 save(1582 条)。
2. 生成 `audit-all.txt`(去重去 AI 后 1541 条)→ 逐段审 → 待删按标题查 id → batch-delete → 全量复查零残留。
3. 用户拍板记录: `pending-questions.md`(矛盾/价格/平台/品牌/医疗/承诺/时效七类)。
4. 已定政策: 医用拆封 7 天可退; 换款 30 天; 无备用机; 1L=96%; Y300W 4/5 档是赠送不保证浓度; **价格/费用/券/补贴/保价/补偿/折旧/押金/保外/赠品挽留话术全部删除, 人工处理**。

## 7. 当前状态(2026-09-04)
- 当前知识库 2004 条（SHOP 1048 / PRODUCT 948 / CHAT 8）；超长无标题卡已完成一轮治理。历史数量以对应备份/审核报告为准。
- 待做: 三问模拟 + 欢迎语配置 + 买家号实测(`compass/summary` 确认自动回复)。
- 工作脚本全新版在 `C:/Users/b3460/.pi-edge-work/`, 已同步到本目录 `scripts/`; 进度见 `audit-state.md`(工作目录)。
