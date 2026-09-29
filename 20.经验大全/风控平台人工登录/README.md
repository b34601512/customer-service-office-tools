# 风控平台「人工登录」必须用原生 Chrome（不要用自动化内核浏览器）

> 2026-09-29 踩坑沉淀。触发场景：给拼多多 DEDAKJ 店人工登录，验证码怎么输都失败；换成原生 Chrome 后一次过。

## 一句话结论

**凡是要「人来登录 / 过人机验证」的页面（拼多多、淘宝天猫、抖音、京东、有赞…），一定要用系统原生浏览器 + 调试端口打开，
不要用 Playwright `launchPersistentContext` / `chromium.launch` 拉起来的浏览器** —— 后者的页面带着自动化痕迹
（`navigator.webdriver=true`、`--enable-automation`、`--remote-debugging-pipe` 等），平台风控会判为「非人工浏览器」，
表现就是**滑块永远不过、短信验证码一直提示失败**（而你以为是自己手慢）。

## 正确姿势（9号 客服数据自动更新 就是这么干的，一直好使）

```powershell
& "C:\Program Files\Google\Chrome\Application\chrome.exe" `
  --remote-debugging-port=9337 `
  --user-data-dir="D:\…\store-chrome-profiles\pdd\pdd03\manual" `
  --no-first-run --hide-crash-restore-bubble --disable-session-crashed-bubble `
  --start-maximized --new-window "https://mms.pinduoduo.com/login/"
```

* 登录由人手动完成；程序只在**需要读数据/发指令时**用 `chromium.connectOverCDP('http://127.0.0.1:9337')` 连上去。
* 端口各项目错开（9号/19号 9333 必须串行、12号 9334、1号 9371；临时的用 9336/9337/9338）。
* 用哪个画像目录（profile）就只开一个窗口 —— 同一个 `--user-data-dir` 再开第二个进程不会带调试口。
* 读完/填完**主动关掉窗口**，否则画像目录被占用，9号 那类采集脚本会起不来。

## 现成的工具

```
node "20.经验大全/风控平台人工登录/打开原生Chrome.cjs" --url "<登录页>" --profile "<画像目录>" [--port 9337]
```

* 只做三件事：拼参数 → 起 `chrome.exe` → 打印调试口地址与「请人工登录」提示；**不加载 Playwright、不带任何自动化参数**。
* 参数构造有单测锁死「不许出现 `--enable-automation` / `--headless`」：`node --test "20.经验大全/风控平台人工登录/测试/打开原生Chrome.test.js"`。

## 判断某个页面算不算「风控平台」

只要登录后会做**资金/发货/评价/售后类动作**的平台都算：拼多多 `*.pinduoduo.com`、淘宝天猫 `*.taobao.com` `*.tmall.com`、
抖音 `*.douyin.com`、京东 `*.jd.com`、快手、小红书、有赞。金山文档/内部探域后台这类**只读协作文档**风险低，自动化窗口通常能过。

## 同仓库同类风险排查

见 [`体检-同类风险-20260929.md`](./体检-同类风险-20260929.md)：哪些项目在用自动化窗口承载人工登录、哪些已经加了缓解、建议怎么改。
