# 该文件用于集中管理受控浏览器的运行参数。
from __future__ import annotations

BROWSER_CACHE_REDUCTION_ARGS = (
    "--disable-background-networking",
    "--disable-component-update",
    "--disable-sync",
    "--metrics-recording-only",
    "--safebrowsing-disable-auto-update",
)


def browser_runtime_arguments(*extra_args: str) -> list[str]:
    # 该函数用于给受控浏览器统一追加减少后台组件下载和缓存膨胀的参数。
    return [*BROWSER_CACHE_REDUCTION_ARGS, *[str(item) for item in extra_args if str(item or "").strip()]]


__all__ = ["BROWSER_CACHE_REDUCTION_ARGS", "browser_runtime_arguments"]
