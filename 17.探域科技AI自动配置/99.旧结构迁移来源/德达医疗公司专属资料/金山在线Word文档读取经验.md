# 金山在线 Word 文档无 GUI 读取经验

## 适用场景

用于读取 `https://www.kdocs.cn/l/{shareId}` 形式的金山/WPS在线文档，尤其是大纲文档（`otl`）。

目标是通过脚本获取完整结构化正文和嵌入图片，不依赖鼠标点击，也不把登录态、Cookie或临时令牌发到云端。

## 核心结论

1. `curl` 通常只能得到网页加载壳，不能代表文档没有内容。
2. `document.body.innerText` 往往只能取得标题、目录和当前已渲染区域，也不是完整正文。
3. 真正的文档内容来自页面加载时的两个 POST 请求：
   - `/api/v3/office/session/{shareId}/otl?first`
   - `/api/v3/office/file/{shareId}/open/otl`
4. `open/otl` 虽然响应头可能是 `application/octet-stream` 和 `deflate`，但 Playwright 的 `response.body()` 通常已经返回解压后的 JSON 字节，可以直接 `JSON.parse()`。
5. 文档中的截图不会出现在普通文本里。图片节点的 `attrs.sourceKey` 要再通过 `/attachment/shapes` 换取临时下载地址。

## 本机环境

- Node.js依赖：`playwright-core`
- 浏览器：Microsoft Edge，`channel: 'msedge'`
- 建议画像：`C:/Users/b3460/.pi-edge-auto`
- 推荐：`headless: true`，全程无GUI操作

不要在脚本或笔记中硬编码Cookie、会话token和图片签名URL。浏览器画像只保存在本机。

## 第一步：先用直连判断页面类型

```powershell
curl.exe -L --max-time 30 -A "Mozilla/5.0" "https://www.kdocs.cn/l/分享ID" -o kdocs.html
```

如果文件只有几十KB、只有脚本加载器、没有完整正文，就转用Playwright抓取网络响应。

## 第二步：捕获完整文档响应

页面自己会生成必要的 `connid`、`group`、CSRF头和请求体，因此不要猜接口参数；监听页面发出的真实响应最稳妥。

```js
const { chromium } = require('playwright-core');
const fs = require('fs');

(async () => {
  const ctx = await chromium.launchPersistentContext(
    'C:/Users/b3460/.pi-edge-auto',
    {
      channel: 'msedge',
      headless: true,
      viewport: { width: 1440, height: 1000 },
    },
  );

  const page = ctx.pages()[0] || await ctx.newPage();
  const pending = [];

  page.on('response', (response) => {
    if (!response.url().includes('/open/otl')) return;

    pending.push((async () => {
      const body = await response.body();
      fs.writeFileSync('kdocs-open-otl.json', body);
    })());
  });

  await page.goto('https://www.kdocs.cn/l/分享ID', {
    waitUntil: 'domcontentloaded',
    timeout: 60000,
  });
  await page.waitForTimeout(15000);
  await Promise.all(pending);
  await ctx.close();
})();
```

验收时至少记录：

- `page.title()`
- `page.url()`
- `open/otl`响应状态和字节数
- JSON能否成功解析

## 第三步：按文档顺序提取正文

常见节点类型：

- `outline-title`：文档标题
- `heading`：章节标题
- `paragraph`：普通段落
- `text`：文字叶子节点
- `picture`：图片节点
- `block_tile`：承载上述节点的块

最简单的正文提取方式是递归读取所有 `text` 字段：

```js
const source = JSON.parse(fs.readFileSync('kdocs-open-otl.json', 'utf8'));
const texts = [];

function walk(node) {
  if (Array.isArray(node)) return node.forEach(walk);
  if (!node || typeof node !== 'object') return;
  if (typeof node.text === 'string') texts.push(node.text);
  for (const value of Object.values(node)) walk(value);
}

walk(source.content);
fs.writeFileSync('kdocs-text.txt', texts.join('\n'), 'utf8');
```

若要保留“标题—段落—图片”的对应关系，应按 `block_tile` 的原始顺序生成记录，再用 `heading` 切分章节，不要只把全文打平成一段。

## 第四步：提取嵌入图片

图片节点示例：

```json
{
  "type": "picture",
  "attrs": {
    "sourceKey": "XXXXXXXXXXXXX",
    "oriWidth": 560,
    "oriHeight": 482
  }
}
```

在已打开文档的页面上下文中调用：

```js
const payload = await page.evaluate(async (sourceKeys) => {
  const response = await fetch(
    '/api/v3/office/file/分享ID/attachment/shapes',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        objects: sourceKeys.map((attachment_id) => ({
          attachment_id,
          max_edge: 2000,
          source: '',
        })),
        expire: 86400000,
        support_webp: false,
        with_thumbnail: true,
        support_lossless: true,
      }),
    },
  );
  return response.json();
}, sourceKeys);
```

响应中的 `data[sourceKey].raw` 是有时效的签名地址。应下载图片到本机后再做OCR或视觉检查，不要把临时URL当永久数据源。

图片较多时先通过章节标题筛选候选，只识别相关截图，避免无意义地处理全部图片。

## 第五步：验证是否真的读全

不要只看浏览器正文长度。建议同时核对：

- 页面显示的“文档字数”
- 提取到的标题/章节数量
- `text`节点数量
- `picture`节点数量
- 首章、末章是否都能找到

本次《2026年售前培训内容》实测：

- 186个章节
- 页面显示15420字
- 634个文字节点
- 349张嵌入图片
- `body.innerText`仅3228字符，明显不完整

## 转为知识库前的筛选原则

1. 只保留可以直接回复买家的内容。
2. 内部培训、审单流程、绩效、销售原则、员工管理内容不能写入知识库。
3. 与现有知识先做标题和正文语义去重。
4. 已有相近知识时补充原卡，不新建重复卡，避免多个真源互相冲突。
5. 新旧培训内容冲突时，以更新日期较新的规则为准，并人工确认关键参数。
6. 标题只供人工管理；正文使用严格的 `Q:`、`A:` 格式。
7. 同时配置店铺、商品和订单阶段范围，商品专属参数不能做成全店通用知识。

## 常见失败点

- 只用 `curl`：只能看到加载壳。
- 只读 `body.innerText`：只能看到目录和当前渲染区域。
- 直接GET `/open/otl`：该接口实际由页面使用POST，请求体不能省略。
- 自己伪造 `connid` 或CSRF：容易返回404/403。
- 忽略图片：培训文档的大量关键回答在截图中。
- 把全部培训文字写进知识库：会把内部指令当成买家话术发送。
- 为相同问题新建多张卡：会造成答案冲突，应优先合并原卡。

## 安全边界

- 登录态、Cookie、session token仅保存在本机。
- 不在日志、笔记或云端消息中输出Cookie和完整请求头。
- 读取文档不代表允许修改文档。
- 写入业务后台前先给用户审核候选问答。
