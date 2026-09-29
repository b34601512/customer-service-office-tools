# 0.头像生成

纯代码生成**木婉清**的 16bit（SNES 风）像素头像：零依赖、零图片素材，只用 Node 标准库。

- `gen-avatar.mjs`：32×32 手绘像素画（16 色板）→ 最近邻放大 → 手写 PNG 编码（zlib + CRC32）。
- 画法：像素画只写左半边 16 列、程序镜像成 32 列（`OVERLAY` 放发带飘带这类不对称小零件）；背景用 4×4 Bayer 有序抖动做脑后微光。

```powershell
node gen-avatar.mjs                          # 出 32×32 原图 + 256×256（scale=8）
node gen-avatar.mjs --scale 16 --out 大图.png # 512×512
node gen-avatar.mjs --no-preview             # 不打印终端字符预览
```

改样子就改 `PALETTE`（色板）和 `LEFT`（像素画，每行 16 字符）；行宽写错会当场报错。

产物 `avatar-muwanqing*.png` 落在本目录，按 `.gitignore` 图片不入库，仓库只存生成器。
