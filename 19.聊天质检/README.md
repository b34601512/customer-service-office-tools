# 19号 聊天质检

面向客服聊天记录的质检工具。当前只处理售前聊天，最终评价由 AI 亲自通读原文完成；程序只负责取数、转换和反馈预览。

## 入口

```powershell
cd "D:\桌面\办公软件\19.聊天质检"
node src/cli.js browser:start
node src/cli.js fetch:list --start YYYY-MM-DD
node src/cli.js fetch:save <sid> --start YYYY-MM-DD
```

反馈文案必须先与用户确认，再使用 `wecom:preview` 预览。多行文案优先写入文件，避免命令行转义：

```powershell
node src/cli.js wecom:preview <聊天文件名> --content-file <文案文件>
```

预览命令不访问 webhook；当前没有自动质检和自动发送命令。

## 唯一经验文档

完整流程、映射来源、浏览器独立启动、企微@机制、换行规则和本次实战结论，统一维护在 [`实战经验.md`](实战经验.md)。其他文档不重复维护经验细节。
