# 16号项目：None误报成功修复与Codex验收

分支：`fix/boss-fetch-none`。基于 `1e40f7e11dff7b6ca178c2cb1cb606994317dd21`。
诊断标识：`fix-none-20260908`。这是测试分支，未经用户确认不要合并。

## 已确认与尚未确认

原版 `TaskRunner` 只捕获 `Exception`，而 `SystemExit`、`KeyboardInterrupt` 可以让工作线程直接结束；`finally` 仍把任务标为完成，结果保持初始的 `None`。日志页又把未识别的结果一律标成绿色成功。直接返回 `None` 也会出现同样的错误提示。

回归测试已在原版精确复现 `✓ 已完成：抓取 国内电商 @ 深圳 → 结果：None`；原版的两项针对性测试失败，修复后新增25项测试全部通过。

这确认了误报漏洞，不代表已查明用户免安装包中是哪一条路径触发，也不能据此断言抓取成功或本地代码一定不同。当前仓库的 `boss_cdp.run_fetch` 已有 `return all_rows`，因此不盲目添加重复return，不把None改成空列表，不伪造条数，不修改网站采集逻辑。

## 修改范围

- `boss_tui.py`：TUI和`--auto fetch`共用岗位列表返回值校验；None/异常类型为失败；抓取内部`SystemExit(0)`也不能算成功。
- 工作线程保留异常类型、完整堆栈及stdout/stderr；正常返回、空结果、部分完成、停止、登录未完成分开显示。
- TUI任务完成后保存完整UTF-8日志到结果目录的同级`logs`文件夹；默认是`%USERPROFILE%\.boss-zhipin-scraper\logs`。日志页按小写`o`打开目录。日志写入失败单独提示，不覆盖采集异常或结果。
- 每次BOSS抓取记录构建标识、Python解释器路径、实际加载的两个模块路径及磁盘文件SHA256，便于核对免安装包。日志不主动记录Cookie、令牌或环境变量；原始业务错误仍可能含业务信息，分享前请检查。
- `test_fetch_result.py`：25项隔离回归测试，加载真实TUI代码，在业务入口注入可控返回值/异常，不访问网站、不启动浏览器。

## Codex拉取和自动测试

在没有未提交修改的仓库工作区执行；有本地改动先保留，勿强制覆盖。

```shell
git fetch origin
git switch --track origin/fix/boss-fetch-none
cd "16.BOSS直聘获取公司名称"
python -m unittest -v test_fetch_result.py
```

已有同名本地分支时使用`git switch fix/boss-fetch-none`，再`git pull --ff-only`。
新增回归测试只用标准库。继续在完整仓库及已安装项目依赖的环境运行原有测试：

```shell
python -m pip install -r requirements.txt
python selftest.py
python -m unittest -v test_release_fixes.py test_jd_shops.py
```

本次已执行：新增25项隔离回归测试、修改文件的Python语法检查、差异空白检查。
本次未执行：原有完整测试套件、Windows控制台和Edge实机采集、免安装包重打包验证。测试通过不等于已经抓到网站数据。

## Windows实机验收

从这个分支的源码目录启动，不要继续双击旧的v0.11免安装包。拉取源码不会自动替换旧安装包里的程序。

先运行`python boss_tui.py`，必要时在工具启动的专用Edge中人工完成登录。先设置“国内电商 / 深圳 / 1页 / csv”，运行抓取，检查新日志中是否有`build=fix-none-20260908`和正确的模块路径。

也可从同一源码目录运行无头入口并保存完整输出：

```shell
python boss_tui.py --auto fetch --keyword "国内电商" --city "深圳" --pages 1 --format csv > fetch-check.log 2>&1
```

`--auto`输出到终端或重定向文件，不创建TUI的任务日志。任务失败时应为非零退出码。成功时核对本次新生成文件、实际条数和日志；不要拿旧CSV当作本次成功证据。无结果时不能显示“已导出”，需要人工查看是否确实无匹配或登录/接口异常。

1页验收后再测试截图中的400页参数；它是上限，网站无更多结果时提前停止属于预期，不保证一定有400页。补测停止采集、错误提示、部分完成和日志页`o`键。涉及验证码或登录验证时由用户正常完成，不绕过验证。

请回传测试命令、通过/失败结果、实际模块路径、日志中的异常堆栈，以及新导出文件的条数；保留草稿状态，等用户确认再合并。
