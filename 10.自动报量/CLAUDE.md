# 项目说明

## 1. 项目目标

从管易 ERP 取得“订单商品明细统计”CSV，按日期、店铺、料号和白夜班汇总有效订单，写入全年报量模板，同时生成 Excel、汇报长图和处理日志；ERP 自动化失败时仍可用本地 CSV 手动补报。

## 2. 技术形态

- Windows Python 3 命令行工具；Playwright 控制 Edge/Chrome 下载 ERP 报表。
- 直接修改 `.xlsx` 内部 ZIP/XML，Pillow 生成结果图，openpyxl 用于测试校验。
- ERP 密码用 Windows 当前用户加密保存；另保留一套纯 HTML/原生 JavaScript 的本地导入工具。

## 3. 模块结构

- `运行自动报量CLI.bat`、`自动报量CLI/自动报量CLI.py`、`auto_report_cli.py`：安装依赖、菜单和完整流程调度。
- `auto_report_erp.py`、`auto_report_credentials.py`：ERP 登录、导出任务、下载及账号保护。
- `auto_report_config.py`、`auto_report_csv.py`、`auto_report_aggregation.py`：读取统一映射、校验 CSV、过滤退款/作废/赠品并聚合。
- `auto_report_xlsx.py`、`auto_report_result_page.py`：写全年模板、刷新汇总缓存并生成 PNG。
- `html导入工具/`：浏览器手动导入入口，`report-config.js` 是模板和店铺料号映射事实；`tools/` 用于模板构建与校验，`tests/` 放回归测试。

## 4. 数据流

`ERP 登录资料` → `浏览器创建并下载 CSV 任务` → `读取字段和映射配置` → `按状态、日期、店铺、料号过滤聚合` → `写入对应月份白班/夜班单元格` → `重算产品、店铺和顶部汇总` → `自动报量输出/Excel结果、截图、日志`。

## 5. 运行与测试

日常双击 `运行自动报量CLI.bat`，首次会按 `requirements.txt` 安装组件；菜单 1 是 ERP 一键流程，菜单 2、3 使用本地 CSV。浏览器备用方式是打开 `html导入工具/点我开始.html` 后选择空白模板、CSV 和日期。测试时进入 `自动报量CLI`，运行 `python -m unittest discover -s tests`。
