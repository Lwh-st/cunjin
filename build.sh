#!/usr/bin/env bash
# 寸进 · 打包脚本（Windows 绿色版）
# 用法：bash build.sh
# 核心：打包前后保留 exe 旁 data/settings.json —— 它是全部业务数据（计时器/进度条/计划/壁纸/配色的底色）。
#      Electron 缓存（Local Storage 等）可重建、且运行时被锁，不必备份。
#      注意：上上版用 tar 整体备份 data 因 LOCK 文件被锁失败，反而什么都不剩 —— 这里只备份 settings.json。
set -e
cd "$(dirname "$0")"

PKG="dist/win-unpacked"
DATA_DIR="$PKG/data"
SETTINGS_SAVE="${TMPDIR:-/tmp}/cunjin-settings-backup.json"

# 杀旧实例（否则 EBUSY 打包失败）
powershell.exe -NoProfile -Command 'taskkill /F /IM 寸进.exe 2>$null' 2>/dev/null || true
sleep 1
powershell.exe -NoProfile -Command 'taskkill /F /IM electron.exe 2>$null' 2>/dev/null || true
sleep 1

# 备份核心用户数据 settings.json（只此一个文件，无锁问题）
rm -f "$SETTINGS_SAVE"
if [ -f "$DATA_DIR/settings.json" ]; then
  cp "$DATA_DIR/settings.json" "$SETTINGS_SAVE"
  echo "[build] 备份 settings.json ($(stat -c '%s' "$SETTINGS_SAVE") bytes)"
else
  echo "[build] 注意: dist/data/settings.json 不存在（可能首次打包），跳过备份"
fi
# 兜底方向修正（2026-09-08 重大教训）：
# ➤ 用户只用打包版 exe → 真实数据 = dist/win-unpacked/data/settings.json！
# ➤ %APPDATA%\寸进 是开发版旧数据，绝不能反向覆盖 dist。
# 兜底仅在 dist 备份【缺失或 0 字节】时，才提示可用 %APPDATA%（不再自动覆盖）。
APPDATA_SET="$APPDATA/寸进/settings.json"
if [ -f "$APPDATA_SET" ]; then
  SAVE_SZ=$(stat -c '%s' "$SETTINGS_SAVE" 2>/dev/null || echo 0)
  if [ "$SAVE_SZ" -eq 0 ]; then
    cp "$APPDATA_SET" "$SETTINGS_SAVE"
    echo "[build] dist 备份缺失/为空，临时采用 %APPDATA% 版本兜底 ($(stat -c '%s' "$APPDATA_SET") bytes)"
  else
    echo "[build] dist data 为主数据源（用户打包版真实数据），保留备份 ($SAVE_SZ bytes)"
  fi
fi

# 删除旧构建（只删构建产物）
rm -rf dist/win-unpacked

export ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/"
export ELECTRON_BUILDER_BINARIES_MIRROR="https://npmmirror.com/mirrors/electron-builder-binaries/"
npx electron-builder --win --x64

# 还原核心用户数据
if [ -f "$SETTINGS_SAVE" ]; then
  mkdir -p "$DATA_DIR"
  cp "$SETTINGS_SAVE" "$DATA_DIR/settings.json"
  echo "[build] 还原 settings.json ($(stat -c '%s' "$DATA_DIR/settings.json") bytes)"
fi
rm -f "$SETTINGS_SAVE"

# 验证：asar 里确实包含 colorpicker（防止打包漏文件还报成功）
if npx asar list "$PKG/resources/app.asar" 2>/dev/null | grep -q -E "renderer[\\/]colorpicker\.html"; then
  echo "[build] 验证 OK: colorpicker.html 已打进 asar"
else
  echo "[build] 警告: asar 中未找到 colorpicker.html，请检查打包配置！"
fi

echo "[build] 完成: $PKG/寸进.exe"
