# YouTube 视频下载与转格式：电脑能播、发出去打不开怎么办

> **一句话**：下载用 `yt-dlp`；打不开先 `ffprobe` 查编码——**AV1/VP9 → 国内平台（微信/抖音等）多数不支持**；
> 转成 `H.264 + AAC + yuv420p + faststart` 就是通杀解。
> 附 `工具\转兼容格式.cjs`：一条命令完成「查编码 → 按需转码 → 验证」。

---

## 一、下载（yt-dlp）

### 装工具（Windows，winget 一条命令）

```bash
winget install yt-dlp.yt-dlp
winget install Gyan.FFmpeg
```

验证：`yt-dlp --version`、`ffmpeg -version`。

### 下载命令

```bash
yt-dlp -f "bv*[ext=mp4]+ba[ext=m4a]/b[ext=mp4]/b" -o "%(title).80s [%(id)s].%(ext)s" --no-playlist "视频链接"
```

- Shorts 链接（`youtube.com/shorts/xxx`）和普通链接都支持，直接贴。
- `-f` 优先 mp4 视频轨 ＋ m4a 音频轨；yt-dlp 自动调 ffmpeg 合并。
- 常用参数：
  - `--no-playlist`：只下单个视频，不拉整个播放列表；
  - `-f "bestvideo+bestaudio/best"`：最高画质（可能是 AV1/VP9，见下节）；
  - `--skip-download --print title`：只拿标题不下载；
  - `-o "文件名.%(ext)s"`：自己指定输出名。

### 小坑（标题）

1. 标题为空/带特殊字符时，文件名可能是一串空格＋`[视频ID].mp4`——下载完手动改名即可。
2. 标题是外语（韩文/日文等）：终端显示乱码不影响文件本身，改名时先 `ls` 认准真实文件名。
3. 标题里的 emoji、空格在脚本里难处理——**直接用 `-o` 起干净的名字最省事**。

## 二、为什么「电脑能播、发出去打不开」

YouTube 主推的新编码 **AV1 / VP9**：

| 播放端 | AV1 / VP9 支持 |
|---|---|
| 电脑浏览器/播放器（Chrome、Edge、PotPlayer） | ✅ |
| 微信内置播放器（尤其手机端） | ❌ 大多不支持 → 打不开 |
| 各类 App、电视、旧手机 | ❌ 经常不支持 |

判断方法（`ffprobe` 是 ffmpeg 自带）：

```bash
ffprobe -v error -show_entries stream=codec_name,codec_type -of default=noprint_wrappers=1 文件.mp4
```

看到 `codec_name=av1`（或 `vp9`）就是原因。国内平台基本只认 **H.264 ＋ AAC**。

## 三、转格式

### 原始命令（了解原理）

```bash
ffmpeg -y -i 原视频.mp4 -c:v libx264 -preset medium -crf 21 -pix_fmt yuv420p \
       -profile:v high -movflags +faststart -c:a aac -b:a 128k 兼容版.mp4
```

- `-c:v libx264`：H.264，全平台通吃；
- `-crf 21`：画质系数，18~23 都合理，**数字越小越清楚、文件越大**；嫌大改 26；
- `-pix_fmt yuv420p`：兼容性关键，不加有些设备仍打不开；
- `-movflags +faststart`：moov 前置，网络播放秒开（发出去/上传必加）；
- `-c:a aac -b:a 128k`：音频转 AAC。

验证：

```bash
ffprobe -v error -show_entries stream=codec_name -of csv=p=0 兼容版.mp4
# 应输出：h264 / aac
```

### 一键脚本（本包工具）

```bash
# 默认输出「原名-兼容版.mp4」，CRF 21
node 转兼容格式.cjs 原视频.mp4

# 自定义输出、压小一点、限高 720
node 转兼容格式.cjs 原视频.webm --out 微信版.mp4 --crf 23 --max-height 720
```

脚本行为（安全约定）：

1. 先用 `ffprobe` **只读**查输入编码；
2. 已是 H.264＋AAC → 直接告诉你不必转（`--force` 可强制）；
3. 否则转码到新文件——**绝不覆盖原片**；输出文件已存在时拒绝执行（先改名/移走）；
4. 转完自动 `ffprobe` 验证输出是 `h264 + aac`，报文件大小对比。

### 常用变体（手动版）

```bash
# 降到 720p 再转
ffmpeg -y -i 原视频.mp4 -vf scale=-2:720 -c:v libx264 -crf 23 -pix_fmt yuv420p -movflags +faststart -c:a aac 兼容版720p.mp4

# 只要音频（提取 BGM）
ffmpeg -y -i 原视频.mp4 -vn -c:a aac 音频.m4a

# 合并多个片段（文件列表.txt 里逐行 file 'xx.mp4'）
ffmpeg -f concat -safe 0 -i 文件列表.txt -c copy 合并.mp4
```

## 四、一句话总结

1. 下载 `yt-dlp`，链接直接贴；
2. 打不开先 `ffprobe` 查编码，**AV1/VP9 → 平台必挂**；
3. 转 `libx264 + yuv420p + faststart` 通杀；
4. 原片和兼容版都留着：原片小而清晰，兼容版通用。

## 五、包里有什么

| 文件 | 干嘛 |
|---|---|
| `工具\转兼容格式.cjs` | 查编码 → 按需转 H.264+AAC → 自动验证；不覆盖原片 |

## 六、实测记录（2026-10-13，Windows + ffmpeg 9.0）

```text
# 造一个 VP9+Opus 的 webm 当素材
$ ffmpeg -f lavfi -i testsrc=... -c:v libvpx-vp9 -c:a libopus 测试素材.webm
# 脚本判定不兼容并转换
$ node 转兼容格式.cjs 测试素材.webm
  → 检测到视频 vp9 / 音频 opus：国内平台不兼容
  → 转换完成：测试素材-兼容版.mp4
  → 验证：h264 / aac ✅
# 对已是 h264+aac 的文件再跑：正确提示「无需转换」
```

（详见包内脚本输出；素材为 1 秒测试图案，非真实影片。）
