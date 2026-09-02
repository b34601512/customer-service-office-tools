# 项目说明

## 1. 项目目标

用本地控制台管理抖音直播间、账号档案和评论库，在受控浏览器里手动发送评论，或按“发送次数最少”自动选句、倒计时发送，达到本次任务数量后停止。

## 2. 技术形态

- Windows 本地 Python 3 应用，使用标准库 HTTP 服务和事件流提供控制页面。
- 使用 Playwright 控制本机 Edge/Chrome；界面由原生 HTML、CSS、JavaScript 编写。
- `config.json` 保存直播间、评论和任务配置，`runtime/` 保存独立登录资料，`logs/current.log` 保存本次日志；可用 PyInstaller 打包。

## 3. 模块结构

- `app_entry.py`、`panel.py`、`server.py`：启动、自检、本地接口和控制页生命周期。
- `service.py`：串联配置、任务计数、实时状态、发送动作和退出清理。
- `browser_control.py`、`browser_resolver.py`：打开直播间、定位评论框、输入并确认发送。
- `config.py`、`comment_library.py`、`comment_importer.py`：校验配置、选择评论，并从 TXT/DOCX 导入评论。
- `web/`：页面及配置、评论库、倒计时、日志等前端模块；`tests/` 放单元测试，`build_release.ps1` 负责发布包。

## 4. 数据流

`config.json` → `本地控制页` → `选择直播间和账号资料` → `Playwright 打开专用浏览器并由用户确认登录` → `手输或评论库填入内容` → `本地接口调用浏览器发送` → `成功次数写回配置` → `状态和日志实时推送页面`。

## 5. 运行与测试

先运行 `python -m pip install -r requirements.txt`，再双击 `一键启动.bat` / `一键启动隐藏.vbs`，或运行 `python app_entry.py`。自检用 `python app_entry.py --check`，测试用 `python -m unittest discover -s tests`。发布版可双击 `一键打包.bat`。账号密码不写入配置，登录状态仅在本项目的浏览器资料目录中。
