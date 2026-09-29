# 0.头像生成

纯代码生成**木婉清**的 16bit 像素头像：零依赖、零图片素材，只用 Node 标准库（PNG 由 `zlib` + 手写 CRC32 编出来）。

- 场景版 `avatar-muwanqing-750.png`：**750×750**（50 像素格 × 15）。
- 纯头像版 `avatar-muwanqing.png`（32×32）/ `avatar-muwanqing-256.png`（×8）。

## 怎么画的

- **分层合成**：夜空渐变 → 月与月晕 → 星点、薄云 → 远山两重（脊线上一条薄雾）→ 背剑（右）、松影（左下）→ 头像剪影 → 四角暗角。
- **头像**只写左半边 16 列、程序镜像成 32 列；发带飘带放在 `OVERLAY`（镜像做不出的不对称零件）。
- **复古感全靠抖动**：明暗过渡一律用 4×4 Bayer 有序抖动，不写渐变，色数少、味道正。

```powershell
node gen-avatar.mjs                 # 750×750 场景版 + 32/256 纯头像
node gen-avatar.mjs --size 500      # 场景版边长（须是 50 的倍数）
node gen-avatar.mjs --preview       # 打印 50 行字符预览（调画用）
```

改样子：`PALETTE`（色板）、`LEFT`（头像像素画，每行 16 字符）、`SWORD`/`PINE`（零件像素画）；行宽写错会当场报错。

产物 png 落在本目录，按 `.gitignore` 图片不入库，仓库只存生成器。
