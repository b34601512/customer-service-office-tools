# 项目说明

## 1. 项目目标

给整个“办公软件”仓库提供一个 Git 内容过滤器：提交项目配置时清空金山文档的 `webhookUrl` 和 `apiToken`，检出文件时再从本机私有存储恢复，避免这两类令牌进入源码备份，同时不影响本地正常使用。

## 2. 技术形态

- 单文件 Node.js 命令行工具，采用 CommonJS，只使用 `fs`、`path` 标准库，无第三方依赖。
- 通过仓库根目录 `.gitattributes` 的 `filter=kdocs-secret` 接入 Git；程序以标准输入接收 JSON，以标准输出返回处理结果。

## 3. 模块结构

- `git-secret-filter.js`：解析 `clean` 或 `smudge` 模式、规范仓库相对路径，并执行字段清空或恢复。
- `git-secret-store.json`：按配置文件相对路径保存本机令牌；已被根目录 `.gitignore` 排除，不属于可提交源码。
- 根目录 `.gitattributes`：让各项目的 `project-config/platform-config.json` 自动经过该过滤器。

## 4. 数据流

提交时，Git 把配置内容和路径交给 `clean`，脚本用空字符串替换两个敏感字段后输出给版本库。检出时，`smudge` 按文件路径查找本机存储，只把非空私密值填回空字段，再输出到工作区。找不到存储项时原样返回；该工具不会处理账号密码等其他字段。

## 5. 运行与测试

平时由已配置的 Git 过滤器自动调用，也可用无真实令牌的样例做只读检查：

```powershell
'{"webhookUrl":"demo","apiToken":"demo"}' | node .\git-secret-filter.js clean demo.json
```

预期两个字段都变为空字符串。当前没有自动化测试或独立依赖安装步骤。
