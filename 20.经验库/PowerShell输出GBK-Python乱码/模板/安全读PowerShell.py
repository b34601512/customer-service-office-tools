# -*- coding: utf-8 -*-
"""安全读 PowerShell 输出（强制 UTF-8，避免 GBK 乱码）——复制即用。

要点：先让 PowerShell 把 stdout 切到 UTF-8（[Console]::OutputEncoding），
      Python 这边再按 UTF-8 解码；失败信息放异常里，别静默。
"""
import subprocess


def 跑PowerShell(命令行, timeout=60):
    """执行 PowerShell 命令并返回 stdout（UTF-8 解码）。失败抛 RuntimeError。"""
    引导 = "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; "
    r = subprocess.run(["powershell", "-NoProfile", "-Command", 引导 + 命令行],
                       capture_output=True, timeout=timeout)
    输出 = r.stdout.decode("utf-8", errors="replace")
    错误 = r.stderr.decode("utf-8", errors="replace")
    if r.returncode != 0:
        raise RuntimeError("PowerShell 退出码 %s：%s" % (r.returncode, 错误.strip()))
    return 输出


if __name__ == "__main__":
    try:  # 直跑自测时：防 GBK 控制台打印崩溃
        import sys
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass
    # 自测：能原样拿回中文就是好的
    结果 = 跑PowerShell("[Console]::WriteLine('中文测试：一切正常')")
    print("拿到：", 结果.strip())
