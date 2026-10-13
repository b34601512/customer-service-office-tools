# 经验包：官网搜不到，就扒前端与安装包（装机 / 调研三招）

> **一句话**：官网是 SPA、搜不到下载直链、功能详情只藏在 App 里——**答案不在页面文字里**：
> ① 前端 JS bundle 里找接口；② 扫 Electron 的 `app.asar` 看功能与文案；③ 大二进制别 grep，按偏移切片。
>
> 用法：把本文件夹交给你的 AI，说「帮我把某官网的下载直链／某应用的功能文案扒出来」。

---

## 招一：SPA 没直链 → 去 JS bundle 里找接口

- **现象**：官网只有一个十几 KB 的壳，下载按钮点了报「获取下载地址失败」，直链搜索里也搜不到。
- **做法**：把页面引用的 JS（`<script src>`／`modulepreload` 列表）批量拉下来，
  在 bundle 里搜 `update`／`download`／`/api`／`installer` 等关键字 →
  命中形如 `ie.get("/v2/update", {params:{platform, channel_id}})` 的接口调用。
- **直接调接口拿直链＋版本号**：

  ```bash
  curl "https://<官网域名>/v2/update?platform=<平台标识>"
  # → {"version":"…","url":"https://<下载域>/…/安装包.exe"}
  ```

- 拿到官方直链后**验签再装**（PowerShell：`Get-AuthenticodeSignature`）。

## 招二：Electron 应用「有什么功能、文案怎么写」→ 扫 `resources/app.asar`

- 安装目录下 `resources\app.asar`（几百 MB 也正常）里，i18n 文案、功能开关全在，**纯字符串搜就够**：

  ```bash
  grep -a -c "关键字" app.asar        # 先数命中
  grep -a -o "关键字" app.asar | head # 再抽取
  ```

- 一般能拿到：集成开关的 key 名、依赖的 SDK 名、功能描述原文——判断「能不能接某系统」不用猜。
- 注意：asar 是二进制容器，字符串可直接搜；里面 `\uXXXX` 转义的文案要解码（见招三工具）。

## 招三：大二进制（>100MB）带上下文搜索 → 别用 grep -P，用 Node 按偏移切片

- **教训**：`grep -a -o -P '.{0,150}中文.{0,250}' app.asar` 在几百 MB 文件上**直接卡死**（几分钟不出结果）。
- **用 `工具\大文件找上下文.cjs`**（整块读入 ＋ `Buffer.indexOf` ＋ `slice` 前后文，秒级）：

  ```bash
  node 大文件找上下文.cjs app.asar 企业微信
  node 大文件找上下文.cjs app.asar '\u4f01\u4e1a' 200 400 --unicode   # 顺手解码 \uXXXX
  ```

## 四、给 AI 的执行说明（速查）

1. 先分清目标：要**下载直链**（招一）还是**功能/文案证据**（招二）；
2. 招一：抓 JS bundle → 搜接口关键字 → `curl` 试探 → 验签再装；
3. 招二/三：拿 `资源\app.asar` 或任意大文件 → 用本包工具搜关键字（**1MB 以上别用 grep -P**）；
4. 全程只读；下载的安装包留本机，别上传。

## 五、包里有什么

| 文件 | 干嘛 |
|---|---|
| `工具\大文件找上下文.cjs` | 大文件按关键词找前后文（秒级）；支持 `\uXXXX` 解码 |

## 六、实测记录（本机，2026-10-13）

造了一个 30MB 测试文件（三处关键词），用工具搜「企业微信」：

```
── 第 1 处 @偏移 1024 ──
AAAAAAAAAAAAAAAAAAAAAAAAAAAAAA企业微信AAAAAAAAAAAAAAAAAAAAAAAAAAAAAA
── 第 2 处 @偏移 15728642 ──
AAAAAAAAAAAAAAAAAAAAAAAAAAAAxx企业微信yyAAAAAAAAAAAAAAAAAAAAAAAAAAAA
── 第 3 处 @偏移 20971520 ──
共 3 处（文件 31457280 字节）
```

**秒级返回**；`\uXXXX` 解码实测：

```
不用解码：AAA\u4f01\u4e1a\u5fae\u4fe1BBB
用 --unicode：AAA企业微信BBB
```

（「grep -P 卡死」为来源现场实录，未复跑。）
