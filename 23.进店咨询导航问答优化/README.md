# 23.进店咨询导航问答优化

**目标**：优化各平台店铺的「进店导航/常见问题自动回复」（客户进店看到的"猜你想问"），提升点击率、减少客服重复回答。

**边界**：只做**检查 + 分析 + 出建议**；**改后台配置前必须先问用户**（业务红线）。

## 平台进度

| 平台 | 入口路径 | 有点击数据？ | 状态 |
|---|---|---|---|
| **京东** | `xi.jd.com/kf-manage-lite` → 欢迎语 → **常见问题库** | ✅ 近7日点击量 | **jd1、jd3 均已优化**（各 10/10 条，无 emoji） |
| 天猫 | 待探索 | ? | ⬜ |
| 拼多多 | 待探索 | ? | ⬜ |
| 抖音 | 待探索 | ? | ⬜ |
| 有赞 | 待探索 | ? | ⬜ |

## 工具

```bash
node src/tools/jd-faq-overview.js --store jd1 --port 9424        # 抓常见问题 + 近7日点击量
node src/tools/jd-faq-overview.js --store jd1 --port 9424 --json # 输出 JSON
node src/tools/jd-faq-apply.js --config config/jd1-目标配置.json --port 9424           # dry-run 看计划
node src/tools/jd-faq-apply.js --config config/jd1-目标配置.json --port 9424 --apply   # 真改后台（幂等）
node src/tools/jd-faq-apply.js --config config/jd3-目标配置.json --port 9425 --apply   # jd3
node src/tools/jd-faq-apply.js --config config/jd3-目标配置.json --port 9425 --dump-config config/导出.json  # 导出当前配置
```

## 经验

- [经验/京东-进店导航问答.md](经验/京东-进店导航问答.md) —— 入口怎么找、页面结构、分析口径、踩坑
