# 项目说明

## 1. 项目目标

这个工具在管易云 ERP 的订单查询页定时扫描退款订单，把尚未处理的订单集中显示在本地后台，并只对“本轮新增且付款日期落在配置范围内”的订单发送 Windows 系统通知。客服可在后台把订单标成核实中、处理中或已处理，也可写备注；已处理订单继续保留，但后续不再重复提醒。

## 2. 技术形态

- Windows 本地 Python 3 程序，使用同步版 Playwright 控制独立 Chrome/Edge。
- 管理后台由 Python 自带 HTTP 服务和原生 HTML/CSS/JavaScript 组成。
- 不依赖 Excel 库，直接用 ZIP/XML 读取 ERP 导出的 XLSX；系统提醒通过隐藏 PowerShell 托盘通知完成。
- 配置、订单状态、监控次数和日志使用 JSON/文本保存在本地。

## 3. 模块结构

- `run.py`、`app_entry.py`：统一启动、日志和 `--check` 自检。
- `refund_reminder/web_control/`、`control_service/`：本地网页后台、配置、定时线程、订单操作和状态快照。
- `refund_reminder/erp_page/`、`erp_navigation.py`：管理受控浏览器，等待订单查询页并执行每轮扫描。
- `refund_reminder/erp_grid/`、`exported_order_workbook.py`：点击查询、全选并导出当前页到 `订单查询.xlsx`，再读取表头和行。
- `order_detector.py`、`payment_time_range.py`：按退款证据和合法平台单号识别订单，再按付款日期筛选通知范围。
- `handled_order_store/`、`order_presenter.py`：持久保存订单状态、备注和前端展示字段。
- `system_notifier.py`、`runtime_maintenance/`：发送系统通知并清理浏览器缓存；`tests/` 是自动化测试。

## 4. 数据流

后台读取 `config.json` → 受控浏览器登录 ERP 并进入订单查询 → 每轮点击查询、等待 5 秒、全选并覆盖导出 `订单查询.xlsx` → 解析导出表 → 找出有退款证据且平台单号有效的订单 → 合并本地处理记录并找出新增未处理订单 → 按最近 N 天付款范围过滤 → 发送 Windows 通知，同时把完整订单池、备注和统计展示在后台。

## 5. 如何运行和测试

```powershell
python -m pip install -r requirements.txt
python run.py                 # 也可双击“一键启动.vbs”
python run.py --check
python -m unittest discover -s tests
```

开始监控前先在受控浏览器登录 ERP，并关闭 Excel/WPS 中打开的 `订单查询.xlsx`，否则程序无法覆盖导出文件。
