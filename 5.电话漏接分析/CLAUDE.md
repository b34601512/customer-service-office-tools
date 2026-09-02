# 项目说明

## 1. 项目目标

从电话系统下载呼损、呼入、呼出报表，直接按原始表展示（呼入/呼出附座席映射姓名列），并提供趋势、客服对比等统计。

## 2. 技术形态

- Windows 本地 Python 3 命令行工具；用 `pywin32` 调用 Excel 读取老式表格。
- Node.js 自动化脚本通过浏览器调试协议控制 Edge/Chrome 登录、查报表和下载文件，不使用网页框架或数据库。
- 配置、回访状态、最近结果和日志均保存在本地 JSON、Excel 与文本文件中。

## 3. 模块结构

- `一键启动.bat`、`电话漏接分析后台/cli.py`：启动入口。
- `missed_call_backend/cli_*`：菜单、输入、表格和日期范围展示。
- `analysis.py`、`normalizers.py`、`excel_reader.py`：清洗号码与时间，统计呼损、通话、客服数据；原始表直显页见 `tui_pages_impl/raw_tables.py`。
- `download_tasks.py`、`automation/`：调用 Node.js 驱动电话系统，下载三类报表或打开原始明细。
- `state_store.py`、`result_cache.py`：保存配置、回访状态及最近分析记录。
- `browser_control.py`、`runtime_maintenance.py`：管理专用浏览器和运行文件；`tests/` 放回归测试。

## 4. 数据流

`下载配置` → `电话系统三份 Excel` → `Excel COM 读取` → 原表直接展示（呼入/呼出/呼损）+ 客服/趋势统计 → 结果及原表写入本地缓存。

## 5. 运行与测试

电脑需安装 Python、`pywin32`、Node.js、Excel 和 Edge/Chrome。日常双击 `一键启动.bat`，或进入 `电话漏接分析后台` 后运行 `python -X utf8 cli.py`。测试命令为 `python -m unittest discover -s tests`。首次下载前在 CLI 中填好账号和日期天数；账号、登录资料与回访记录不要外传。
