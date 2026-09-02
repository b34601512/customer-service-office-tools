# 项目说明

## 1. 项目目标

把一个或多个本地视频依次压到指定体积以内，默认上限为 25MB；原视频不覆盖，结果另存为 MP4。项目同时提供稳定的桌面界面和命令行入口。

## 2. 技术形态

- Windows 本地 Python 工具，界面使用 Tkinter，命令行使用 `argparse`。
- `imageio-ffmpeg` 自带 FFmpeg；压缩采用 H.264、AAC 和两遍码率控制。
- `build_release.py` 使用 PyInstaller 生成单文件程序。

## 3. 模块结构

- `main.py`：统一入口，按参数进入 GUI 或 CLI。
- `video_compressor/ui/`：文件选择、参数、后台线程、进度和日志。
- `video_compressor/compression/`、`media/`：探测视频、规划码率、执行压缩和超标重试。
- `video_compressor/config/`：读写 `config.json`；`progress/`、`utils/` 提供进度、日志和运行路径。
- `tests/`：码率和真实压缩测试；根目录脚本负责安装、启动和打包。

## 4. 数据流

`选择视频和目标大小` → `读取配置并定位 FFmpeg` → `探测时长和体积` → `反推音视频码率` → `临时目录两遍压缩` → `检查成品`。超标时收紧码率，最多尝试三次；成功后移入输出目录，进度和日志送到界面或终端。

## 5. 运行与测试

```powershell
# 首次安装与图形界面启动
.\安装依赖.bat
.\启动程序.bat

# 命令行压缩与自动化测试
.\.venv\Scripts\python.exe -B main.py "D:\视频\示例.mp4" --target-size-mb 25
.\.venv\Scripts\python.exe -m unittest discover -s tests -v
```
