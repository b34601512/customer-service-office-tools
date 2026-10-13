#!/usr/bin/env bash
# 演示：Git Bash 里 `> nul` 会真的建出一个「nul」文件；并演示正确的清理姿势。
# 注：.sh 里变量名用 ASCII——中文变量名 bash 不认（本包第 4 条坑，整理本包时又踩了一次）。
# 运行：bash 复现/nul文件现场.sh    （一次性目录里跑；脚本自带清理）
set -u
DIR="${TMPDIR:-/tmp}/gitbash-nul-demo-$$"
mkdir -p "$DIR" && cd "$DIR" || exit 1

echo "工作目录：$DIR"
echo
echo "1) 错误示范：在 bash 里想「屏掉输出」写了 > nul —— 真建出一个文件："
echo "   demo" > nul 2>&1 || true
ls -la | grep -i nul || echo "   （咦，没建出来？）"

echo
echo "2) 先用 git-bash 的 rm 试："
if rm -f nul 2>/dev/null; then
  echo "   git-bash 的 rm 删掉了（MSYS 有特殊处理）——但 Windows 原生程序常常删不动，见第 3 步"
else
  echo "   rm 删不掉——换第 3 步的 \\\\?\\ 前缀法"
fi

echo
echo "3) 严格复现 + 用「\\\\?\\ 前缀」清理（先备份内容）："
echo "   demo2" > nul 2>&1 || true
python - <<'PY'
import os, sys
if not os.path.exists("nul"):
    print("   本环境建不出 nul，跳过"); sys.exit(0)
# 注意：绝对不要对 "nul" 本身调 abspath——Windows 会给出 \\.\nul 设备路径，\\?\ 前缀就废了
长 = "\\\\?\\" + os.getcwd() + "\\nul"
try:
    数据 = open(长, "rb").read()
    open("nul.内容备份.bin", "wb").write(数据)
    os.remove(长)
    print("   已备份到 nul.内容备份.bin，并删除 nul。")
except Exception as e:
    print("   \\\\?\\ 法没成（%r）；再试直接 os.remove：" % e)
    try:
        os.remove("nul"); print("   os.remove 删掉了")
    except Exception as e2:
        print("   也没成（%r）——请用 模板/清保留名文件.py" % e2)
PY
echo
echo "4) 收尾："
ls -la
echo
echo "教训：bash 里屏输出用  > /dev/null 2>&1 ；『nul』这个名字在 Windows 上碰不得。"
