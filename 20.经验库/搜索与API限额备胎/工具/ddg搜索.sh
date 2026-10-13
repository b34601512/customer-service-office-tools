#!/usr/bin/env bash
# DDG 搜索小工具：优先直连 html.duckduckgo.com；被风控（anomaly 页）就自动走 r.jina.ai 代理。
# 用法：bash ddg搜索.sh "关键词" [条数=8]
# 输出：标题 + 真实链接（已从 DDG 的 uddg 跳转参数解码）
set -u
q="${1:?用法：bash ddg搜索.sh \"关键词\" [条数]}"
n="${2:-8}"
UA="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"

resp=$(curl -s -m 20 -A "$UA" -G --data-urlencode "q=$q" "https://html.duckduckgo.com/html/")

if printf '%s' "$resp" | grep -q "anomaly"; then
  # 直连被风控：改走 r.jina.ai 代理（实测能拿到结果页）
  echo "（直连被 DuckDuckGo 风控，改走 r.jina.ai 代理）" 1>&2
  enc=$(python -c "import sys,urllib.parse;print(urllib.parse.quote(sys.argv[1]))" "$q")
  resp=$(curl -s -m 45 "https://r.jina.ai/https://html.duckduckgo.com/html/?q=$enc")
  out=$(printf '%s\n' "$resp" | grep -oE '^## \[[^]]+\]\([^)]+\)' | head -n "$n")
  if [ -z "$out" ]; then
    echo "（代理也没抓到结果：稍后重试或换出口）"
    exit 1
  fi
  printf '%s\n' "$out" | while IFS= read -r line; do
    title=$(printf '%s' "$line" | sed -nE 's/^## \[([^]]+)\].*/\1/p')
    link=$(printf '%s' "$line" | sed -nE 's/^## \[[^]]+\]\(([^)]+)\).*/\1/p')
    real=$(printf '%s' "$link" | sed -nE 's/.*[?&]uddg=([^&]+).*/\1/p')
    if [ -n "$real" ]; then
      real=$(printf '%s' "$real" | python -c "import sys,urllib.parse;print(urllib.parse.unquote(sys.stdin.read().strip()))" 2>/dev/null || printf '%s' "$real")
      link="$real"
    fi
    echo "- $title"
    echo "  $link"
  done
  echo "（经 r.jina.ai 代理）"
  exit 0
fi

out=$(printf '%s' "$resp" | tr '\n' ' ' | grep -oE '<a[^>]*class="result__a"[^>]*>[^<]*' | head -n "$n")
if [ -z "$out" ]; then
  echo "（没抓到结果：直连返回里没有结果块——可能被风控/网络问题；可重试或换出口）"
  exit 1
fi
printf '%s\n' "$out" | while IFS= read -r line; do
      link=$(printf '%s' "$line" | sed -nE 's/.*href="([^"]+)".*/\1/p')
      title=$(printf '%s' "$line" | sed -nE 's/.*>([^>]*)$/\1/p')
      real=$(printf '%s' "$link" | sed -nE 's/.*[?&]uddg=([^&]+).*/\1/p')
      if [ -n "$real" ]; then
        real=$(printf '%s' "$real" | python -c "import sys,urllib.parse;print(urllib.parse.unquote(sys.stdin.read().strip()))" 2>/dev/null || printf '%s' "$real")
        link="$real"
      fi
      echo "- ${title:-（无标题）}"
      echo "  $link"
    done
echo "（来源：html.duckduckgo.com）"
