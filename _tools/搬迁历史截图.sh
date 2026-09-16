#!/usr/bin/env bash
# 把历史截图凭证搬到备份文件夹（用户 2026-09-16 要求：截图全部停用，历史凭证移出工作区待手动删除）。
# 只搬「截图类」文件；浏览器资料目录自带的图标资源、Python venv 资源、客户聊天图片一律不动。
set -u
WORK="D:/桌面/办公软件"
BACKUP="$WORK/历史凭证备份/截图凭证_20260916"
IMG_RE='.*\.\(png\|jpg\|jpeg\|webp\|bmp\)$'

moved=0
bytes=0

move_file() {
  local src="$1" rel="$2"
  local dst="$BACKUP/$rel"
  mkdir -p "$(dirname "$dst")"
  local size
  size=$(stat -c %s "$src" 2>/dev/null || echo 0)
  mv "$src" "$dst" 2>/dev/null || return 0
  moved=$((moved + 1))
  bytes=$((bytes + size))
}

# 1) 整个目录都是截图凭证的：整目录搬走（含 json/txt 元数据）
move_tree() {
  local root="$1" label="$2"
  [ -d "$root" ] || return 0
  while IFS= read -r f; do
    rel="${f#$WORK/}"
    move_file "$f" "$rel"
  done < <(find "$root" -type f 2>/dev/null)
}

# 2) 只搬图片、其他文件保留
move_images_only() {
  local root="$1" depth="$2"
  [ -d "$root" ] || return 0
  local find_args=("$root" -type f)
  [ "$depth" = "maxdepth1" ] && find_args=("$root" -maxdepth 1 -type f)
  while IFS= read -r f; do
    rel="${f#$WORK/}"
    move_file "$f" "$rel"
  done < <(find "${find_args[@]}" 2>/dev/null | grep -i "$IMG_RE")
}

# ---- 9号：evidence 全量图片 + 天猫 checkpoints 图片 + cache 顶层图片 ----
move_images_only "$WORK/9.客服数据自动更新/runtime/evidence" ""
move_images_only "$WORK/9.客服数据自动更新/runtime/cache/snapshots/tmall" ""
move_images_only "$WORK/9.客服数据自动更新/runtime/cache" "maxdepth1"
move_images_only "$WORK/9.客服数据自动更新/runtime/manual-verification" ""

# ---- 12号：evidence 图片（txt 证据保留） ----
move_images_only "$WORK/12.店铺指标数据自动更新/runtime/evidence" ""

# ---- 2号：各子项目 screenshots 整目录 + 巡检/回传 runtime 顶层图片 ----
move_tree "$WORK/2.发票自动化/1.京东开票巡检/runtime/screenshots" ""
move_images_only "$WORK/2.发票自动化/1.京东开票巡检/runtime" "maxdepth1"
move_tree "$WORK/2.发票自动化/2.京东发票回传/runtime/screenshots" ""
move_images_only "$WORK/2.发票自动化/2.京东发票回传/runtime" "maxdepth1"
move_tree "$WORK/2.发票自动化/3.通用发票下载中心/runtime/screenshots" ""
move_tree "$WORK/2.发票自动化/4.天猫发票回传/runtime/screenshots" ""
move_tree "$WORK/2.发票自动化/5.拼多多发票回传/runtime/screenshots" ""
move_tree "$WORK/2.发票自动化/6.抖音发票回传/runtime/screenshots" ""
move_tree "$WORK/2.发票自动化/6.抖音发票回传/runtime/douyin-element-collection" ""
move_images_only "$WORK/2.发票自动化/6.抖音发票回传/runtime/debug-douyin-export-submit" ""

# ---- 其他项目 ----
move_images_only "$WORK/1.客服超时督办/runtime" "maxdepth1"
move_tree "$WORK/4.仅退款自动提醒/runtime/visual_checks" ""
move_tree "$WORK/13.客服培训课件制作/runtime/tmp-shots" ""

echo "已搬走 ${moved} 个文件，共 $(awk "BEGIN{printf \"%.1f\", $bytes/1048576}") MB"
echo "备份位置：$BACKUP"
