# 网页链接 → EPUB → Kindle：极简交接大纲

> **一句话**：把书籍网页做成 Kindle 能读的文件，分五步——
> **整理内容 → Pandoc 生成 EPUB → 体检修复 → Calibre 转 AZW3 → 复制到 Kindle 并校验**。
> 全程**不覆盖、不删除**任何原文件；每个环节的输出都是新文件。
>
> 适用：有公开网页或已获授权源码的书籍。把本文件夹交给 AI，按「`模板\给AI的任务指令.md`」填写后执行。

---

## 总览

```text
书籍链接 → 有序 EPUB → 检查/修复 → AZW3 → USB 复制到 Kindle
```

原则：**保留图片**；不改原网页源码、不覆盖原 EPUB、不删除任何已有文件；先确认版权和可处理范围。

## 第 1 步：获取并整理内容

1. 从链接找**官方公开源码**（优先 GitHub）或用户授权内容；先确认版权与可处理范围。
2. 找到 Markdown/HTML、图片及官网目录配置；**按官网目录顺序**整理章节。
3. 在项目外或临时目录操作，不动原源码。
4. 修正图片相对路径；图片必须真正进入 EPUB。
5. SVG 转 PNG，提升 Kindle 兼容性。
6. 音频/视频（如 MP3）通常不打包进普通电子书（体积大、阅读体验有限）——保留文字或外链，除非明确要求内嵌。

## 第 2 步：生成 EPUB（Pandoc）

1. 用 Pandoc 把有序章节生成 **EPUB3**；
2. 写入书名、作者、语言、目录和封面（如有）；
3. 输出为新文件：`<书名>-Kindle.epub`——**绝不覆盖原文件**。

```bash
pandoc 章节1.md 章节2.md ... -o "书名-Kindle.epub" --metadata title="书名" --toc
```

## 第 3 步：EPUB 验收与修复

先**只读检查**（用本包工具，一条命令）：

```powershell
powershell -ExecutionPolicy Bypass -File 工具\查EPUB.ps1 "书名-Kindle.epub"
```

体检项：mimetype / container.xml / OPF(manifest·spine) / 资源齐全（缺图、缺章节）/ 空白章节 / 图片清单。

对照来源材料还应人工确认：章节数量与官网顺序、NCX/nav 目录、本地链接与锚点、脚注、中文与标题。

**有问题时的修法**（只在新文件上改）：

1. 不改原 EPUB；
2. 新建 `<书名>-Kindle-fixed.epub`；
3. 修完全部失效资源/链接/目录问题；
4. 修复后再跑一遍体检，报告剩余错误数。

## 第 4 步：转 Kindle USB 侧载格式（Calibre）

实测要点：**本机 Kindle 直接复制原始 EPUB 到 `documents` 不显示，AZW3 正常**。

1. 用 Calibre 的 `ebook-convert`：`EPUB → AZW3`；
2. 选择 `--output-profile kindle_pw3`（新款 Kindle 可按型号调整）；
3. 先输出到电脑本地，检查 AZW3 可读性与图片资源；
4. 输出新文件 `<书名>.azw3`，**不覆盖原 EPUB**。

```bash
ebook-convert "书名-Kindle.epub" "书名.azw3" --output-profile kindle_pw3
```

## 第 5 步：复制到 Kindle 并验收

1. Kindle 连上电脑后，确认**盘符**与 `documents` 目录（每台机器盘符可能不同）。
2. 复制 `.azw3` 到该目录；**先检查同名文件不存在，禁止静默覆盖**。
3. 用 **SHA256** 对比电脑与 Kindle 上两份文件，确认复制完整。
4. 断开 Kindle，在「图书馆 → 全部」搜书名；抽查目录、图片、链接、脚注。

## 格式选择

| 通道 | 用哪种格式 |
|---|---|
| Send to Kindle / 云端同步 | 上传 **EPUB** |
| USB 手动侧载 | 优先 **AZW3**（本机实测 EPUB 不被识别） |

## 工具链

| 工具 | 用途 | 安装 |
|---|---|---|
| Pandoc | Markdown/HTML → EPUB3 | `winget install JohnMacFarlane.Pandoc` |
| Calibre | EPUB → AZW3（`ebook-convert`） | `winget install calibre.calibre` |
| 本包 `工具\查EPUB.ps1` | EPUB 结构只读体检 | 无需安装（Windows PowerShell） |

## 包里有什么

| 文件 | 干嘛 |
|---|---|
| `工具\查EPUB.ps1` | EPUB 结构与资源只读体检（mimetype/OPF/缺资源/空白章节/图片） |
| `模板\给AI的任务指令.md` | 填好就能发给 AI 的端到端任务书 |

## 实测记录（2026-10-13，Windows + Pandoc 3.10）

```text
# 好例：两个 md 章节 + 一张 png → pandoc 生成 EPUB
$ powershell -File 查EPUB.ps1 test.epub
  [✓] mimetype 正确；container.xml 可解析，OPF = EPUB/content.opf
  [✓] manifest 7 项，spine 4 章；资源齐全；无空白章节
  图片 1 张（16x16 测试图）
  == 结论：结构体检通过 ==（退出码 0）

# 坏例：手工造的残书（mimetype 错、缺图、章节过短）
$ powershell -File 查EPUB.ps1 broken.epub
  [✖] mimetype 内容不是 application/epub+zip
  [✖] 缺资源 1 项：img/missing.png
  [!] 疑似空白/极小文件 1 个
  == 结论：发现 2 个问题 ==（退出码 1）
```

（AZW3 转换与 Kindle 侧载为来源材料实录，本包未在本机复跑。）
