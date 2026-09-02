# 视频压缩工具

当前版本：`v0.01`

## 作者与版权

作者：黎路遥 ｜ 微信：luyao2089 ｜ 话术精灵官网：luyao2089.cc

版权所有 © 黎路遥，保留所有权利。本软件仅供学习交流，未经作者书面授权不得用于商业用途。

这是一个基于 Python 的桌面小工具，默认把视频压缩到「25MB 以下」，也支持自定义目标大小。

## 功能特点

- 自动把视频压缩到指定体积以下，默认是 `25MB`
- 支持一次选择多个视频，按顺序自动处理
- 自带图形界面，也支持命令行调用
- 压缩时会实时显示「当前动作 + 真进度条」
- 不依赖系统全局安装 `ffmpeg`，程序会使用 `imageio-ffmpeg` 提供的可执行文件
- 每一步都会打印统一格式的中文日志，方便后续排查问题

## 首次使用

1. 安装依赖

```powershell
python -m pip install -r requirements.txt
```

2. 启动图形界面

```powershell
python main.py
```

3. 或者使用命令行

```powershell
python main.py "D:\视频\示例.mp4" --target-size-mb 25 --output-dir "D:\视频\输出"
```

## 配置文件

默认配置保存在根目录的 `config.json`：

- `target_size_mb`：默认目标大小
- `output_dir`：默认输出目录

图形界面和命令行都会共用这份配置。

## 自动化测试

```powershell
python -m unittest discover -s tests -v
```

## 打包发布

```powershell
python build_release.py
```

打包完成后，可执行文件会出现在 `release/视频压缩工具_v0.01/` 目录下。
