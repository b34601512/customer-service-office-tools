# 项目说明

## 1. 项目目标

这个工具用于自动做京东客服响应时间测试。它打开一套独立的咚咚客服网页和买家咨询网页，自动生成测试文字，在买家端与客服端之间交替写入并发送，代替人工反复切窗口、复制和回车；运行轮数、发送间隔、工作/休息节奏和账号都能在本地后台配置。

## 2. 技术形态

- Windows 本地 Python 3 程序，使用同步版 Playwright 控制系统里的 Chrome 或 Edge。
- 管理界面是 Python 自带 HTTP 服务加原生 HTML/CSS/JavaScript，不依赖桌面 GUI 框架。
- 全局热键通过 Windows 接口读取；配置为 JSON，日志、浏览器资料和使用记录放在 `logs/`、`runtime/`。

## 3. 模块结构

- `run.py`、`app_entry.py`：统一启动、启动日志和 `--check` 自检入口。
- `clipboard_relay/web_control/`：本地网页后台、配置表单、登录按钮、运行状态和退出清理。
- `clipboard_relay/config/`、`login_flow.py`：读取账号、买家链接、发送节奏并按“客服端后买家端”引导登录。
- `clipboard_relay/browser_control/`：把 Playwright 操作集中到独立线程，管理两套持久浏览器页面。
- `clipboard_relay/browser_dom/`：寻找输入框、写入后回读校验，再点击发送按钮或按回车。
- `clipboard_relay/controller.py`、`temp_content.py`、`hotkeys.py`：生成测试内容，交替发送，处理 F8 暂停/继续和 F9 停止。
- `tests/`：配置、浏览器控制、网页后台、运行清理和内容生成测试。

## 4. 数据流

后台读取 `config.json` → 打开受控浏览器并保存两端登录态 → 内容生成器产生一条测试文字 → 买家咨询页定位输入框、写入、回读并发送 → 等待配置间隔 → 客服页选择会话并同样发送 → 更新轮次和状态 → 循环到完成或收到停止信号；过程写入日志和运行记录，不经过系统剪贴板。

## 5. 如何运行和测试

```powershell
python -m pip install -r requirements.txt
.\一键启动.bat
python run.py --check
python -m unittest discover -s tests
```

也可用 `python run.py` 直接启动。两个网页登录完成后在后台点“启动”或按 F8；退出时用后台退出按钮或 F9，程序会清理自己打开的浏览器。
