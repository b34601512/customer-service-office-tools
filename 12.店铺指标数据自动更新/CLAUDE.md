# 项目说明

## 1. 项目目标

在 Windows 控制台中管理京东、天猫、拼多多、抖音多家店铺，读取官方考核页面的店铺整体指标并更新统一 Excel 数据源。支持当天成功任务跳过、失败隔离、现场凭证和可选金山同步，不采集个人明细。

## 2. 技术形态

- Node.js CommonJS 命令行程序，不启动网页服务。
- `playwright-core` 连接程序拉起的 Chrome/Edge，并复用隔离的登录资料。
- `xlsx`、`jszip`、`@xmldom/xmldom` 原子更新 `.xlsx`；HTTPS webhook 调用金山 AirScript。

## 3. 模块结构

- `src/cli/`：首页、配置、进度和同步菜单；`controlCenter/` 负责逐店调度。
- `src/config/`、`project-config/`：店铺、日期、表格和运行目录配置。
- `src/platforms/`：四个平台的登录、切店、页面读取、解析和指标映射。
- `src/engine/`、`shared/`：浏览器、进程、弹窗、凭证、文件和任务历史。
- `src/metrics/`、`summaryData/`：生成记录键并读写 18 列“数据源”。
- `src/kdocsSync/`：全量替换在线数据源并回读数量；`tests/` 覆盖各主链路。

## 4. 数据流

`读取配置和历史` → `检查表格占用` → `筛选启用店铺` → `复用当天完整结果或打开浏览器` → `登录、切店、读页面` → `生成带日期、来源和记录键的指标` → `覆盖或追加 Excel` → `保存凭证和历史` → `按需同步金山文档`。单店失败不阻断后续店铺。

## 5. 运行与测试

```powershell
npm ci
.\启动控制台.bat   # 也可 npm start
npm test
```

正式汇总前应关闭目标 Excel；`project-config/` 和 `runtime/` 含敏感信息，不应外传。
