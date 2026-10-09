# 通用发票下载中心

## 作者与版权

作者：黎路遥 ｜ 微信：luyao2089 ｜ 话术精灵官网：luyao2089.cc

版权所有 © 黎路遥，保留所有权利。本软件仅供学习交流，未经作者书面授权不得用于商业用途。

这个项目只负责从发票系统下载发票，不负责京东、抖音、拼多多等平台的回传。

## 日常使用

双击项目根目录的 `启动下载中心.bat`，在命令行菜单中选择操作：

1. 查看当前状态
2. 配置诺诺账号和检索范围
3. 检查诺诺登录
4. 批量下载发票
5. 查看本地发票
6. 打开下载目录
7. 导入旧京东配置
0. 退出

也可以在项目目录运行：

```powershell
npm install
npm start
npm test
```

命令行是本项目的日常管理入口，不启动本项目管理网页。菜单按功能分组展示，进入功能页和返回首页都会清屏；操作结果会停留到按回车后再返回。选择“查看当前状态”会实时验证诺诺登录状态，并用不同颜色区分已登录、未登录和需要人工处理。诺诺登录遇到验证码时，仍会打开诺诺自己的登录窗口；完成后回到命令行按提示继续。

## 数据和边界

- 账号配置保存在 `data/invoice-system-config.json`。
- 登录态保存在 `data/invoice-system-auth-state.json`。
- 发票索引保存在 `data/invoice-file-index.json`。
- 发票文件按订单号保存在 `runtime/downloads`。
- 运行日志保存在 `runtime/latest-run.log`。
- 已下载发票会按订单号复用；缺失发票才进入诺诺下载流程。
- 多开票主体会按配置查询；默认查询全部主体。
- 本项目只维护“订单号 ↔ 发票文件”对应关系，不保存 `workflowStatus`，也不增加人工订单状态菜单。

## 对外调用

其它项目可以继续使用本地 HTTP 服务。该服务只提供接口，不提供管理网页：

```powershell
npm run server
```

主要接口：

- `GET /api/health`：健康检查。
- `GET /api/service/status`：服务状态。
- `POST /api/service/shutdown`：关闭服务。
- `GET /api/config`：查看脱敏配置状态。
- `POST /api/config`：保存配置。
- `POST /api/config/search-range`：保存检索天数。
- `POST /api/config/import-jd`：迁移旧京东项目配置。
- `POST /api/login/check`：检查诺诺登录。
- `GET /api/invoices/local`：查看本地发票。
- `POST /api/invoices/local`：导入已有发票文件。
- `GET /api/downloads/path`：查看下载目录。
- `POST /api/downloads/open`：打开下载目录。
- `POST /api/invoices/download`：批量下载发票。

也可以直接引用 Node 模块：

```js
const { 批量下载发票文件 } = require('D:/桌面/办公软件/2.发票自动化/3.通用发票下载中心/src');

const files = await 批量下载发票文件({
  orders: [{ platform: 'jd', orderNumber: '3526239002731910' }],
});
```

## 旧京东配置迁移

已有旧京东项目配置时，可以在菜单中选择“导入旧京东配置”，也可以单独运行：

```powershell
npm run import:jd-config
```

## 当前限制

发票下载使用诺诺登录会话和真实接口。登录窗口需要人工处理验证码或隐私确认时，程序会明确提示，不会猜测点击结果。
