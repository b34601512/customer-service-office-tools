# -*- coding: utf-8 -*-
"""解排班示例：2026 年 10 月案例（跨月重排）。这是**模板**，下月复制改顶部配置即可。

思路（每月都通用）：
  1. 先定休息（人手工设计，或按跨月/连上约束搜索）——每天谁休是排班的地基
  2. 晚班：随机重启搜索，均衡每人晚班天数、成段、只接休息或继续晚
  3. 值班：和晚班联合搜索（只均衡晚班可能让值班“不连值”无解）
  4. 售后同样按“每天保 2 早”的目标解晚班
配置在下面「案例配置」一节；输出计划 JSON，直接喂给 `写排班表.py`。

用法：
    python "工具\\解排班示例.py"                       # 输出到默认路径
    python "工具\\解排班示例.py" --out "测试数据\\2026年11月-计划.json"
"""
from __future__ import annotations

import argparse
import json
import random
from functools import lru_cache
from pathlib import Path

# ---------------------------------------------------------------- 案例配置（下月改这里）

DAYS = list(range(1, 32))
SELLERS = ["韩欢欢", "麦诺谦", "叶炳辉", "徐佳楠", "刘秀文"]
AFTER = ["李守耀", "缪婷婷", "柯紫婷", "邓远祥", "陈燕玲"]
LEAD = "李守耀"

# 上月末状态：last_shift(上月末最后一天) + 到那天的连上天数（从真实表/快照取）
SEP = {
    "韩欢欢": ("早", 1), "麦诺谦": ("休", 0), "叶炳辉": ("晚", 3),
    "徐佳楠": ("早", 6), "刘秀文": ("晚", 4),
    "李守耀": ("早", 5), "缪婷婷": ("晚", 1), "柯紫婷": ("晚", 3),
    "邓远祥": ("休", 0), "陈燕玲": ("早", 2),
}
# 上月末还在晚班的人（本月 1 号只能继续晚或休）
PRE_LATE_SELLER = {"叶炳辉", "刘秀文"}
PRE_LATE_AFTER = {"缪婷婷", "柯紫婷"}

# 售前休息：手工设计（每天 1 人休，跨月 + 相邻休 3~6 天，见 排班经验.md）
SELLER_REST = {
    "韩欢欢": [4, 10, 13, 19, 24, 29],
    "麦诺谦": [5, 9, 15, 20, 25, 30],
    "叶炳辉": [3, 8, 14, 17, 23, 28],
    "徐佳楠": [1, 7, 12, 18, 21, 26],
    "刘秀文": [2, 6, 11, 16, 22, 27, 31],
}

# 售后：组长「上五休一」顺延；其余 4 人按约束搜索（首次休息期限 + 每天最多 2 人休）
LEAD_REST = [1, 7, 13, 19, 25, 31]
OTHERS = ["缪婷婷", "柯紫婷", "邓远祥", "陈燕玲"]
FIRST_DEADLINE = {"柯紫婷": 3, "陈燕玲": 4, "缪婷婷": 5, "邓远祥": 6}
FIXED_REST = {"缪婷婷": {14}, "柯紫婷": {12}}       # 固定休息日（橙格所在）
N_REST = 12                                          # 其余 4 人各休 12 天

# 表里用到的元信息（写回表时用）
META = {
    "days": 31,
    "policy_rest": 6,
    "policy_note": "大小周",
    "lead": LEAD,
    "carry": {  # 剩余（上月结转）——从 1.客服超时督办/runtime/schedule-query-snapshot 的上月表取
        "韩欢欢": "0", "麦诺谦": "1天", "叶炳辉": "-3小时", "徐佳楠": "5天", "刘秀文": "3天4小时",
        "李守耀": "1天", "缪婷婷": "-1天", "柯紫婷": "5天", "邓远祥": "1小时", "陈燕玲": "1天3小时",
    },
    "codes": {"缪婷婷|8": "行", "陈燕玲|16": "行"},
    "orange": ["柯紫婷|12", "缪婷婷|14"],
    "white": ["麦诺谦|15"],
    # 剩余列宽度：不写 → 写表工具会自动跟“每日排班格宽”（列 C）一致
}

MAX_STREAK = 5   # 连续上班上限（含跨月）

# ---------------------------------------------------------------- 通用工具


def check_rest(name: str, rest, month_days: int) -> list[str]:
    """跨月 + 月内连上校验（连上 = 上月末连上 + 本月到首次休息）"""
    _, trail = SEP[name]
    ds = sorted(rest)
    errs = []
    if not ds:
        return errs
    if trail + ds[0] - 1 > MAX_STREAK:
        errs.append(f"{name}: 跨月连上 {trail}+{ds[0] - 1} > {MAX_STREAK}")
    for a, b in zip(ds, ds[1:]):
        if b - a - 1 > MAX_STREAK:
            errs.append(f"{name}: 月内连上 {b - a - 1} 天 (> {MAX_STREAK})")
    if month_days - ds[-1] > MAX_STREAK:
        errs.append(f"{name}: 月末连上 {month_days - ds[-1]} 天 (> {MAX_STREAK})")
    return errs


def build_shifts(names, rest, late_days, lead: str = "") -> dict[str, list[str]]:
    """早（默认）/晚/休（空串）；`lead` 只上早班。"""
    return {p: [("" if d in rest[p] else ("晚" if (p != lead and d in late_days.get(p, ()))
                                          else "早")) for d in DAYS] for p in names}


def solve_lates(group, rest, pre_late, target_fn, forbid=(), rounds=60000, seed=1):
    """随机重启解晚班：每天 target_fn(d, 在岗人) 个晚班，均衡天数 + 惩罚长段。"""
    rng = random.Random(seed)
    best = None
    for _ in range(rounds):
        counts = {p: 0 for p in group if p not in forbid}
        late_prev = set(pre_late)
        late_days = {p: [] for p in group if p not in forbid}
        ok = True
        for d in DAYS:
            ws_ = [p for p in group if d not in rest[p] and p not in forbid]
            forced = late_prev & set(ws_)
            need = target_fn(d, ws_) - len(forced)
            pool = [p for p in ws_ if p not in forced]
            if need < 0 or need > len(pool):
                ok = False
                break
            chosen = set()
            if d == 1:  # 上月末晚班的人，本月 1 号在岗就必须继续晚
                extra = [p for p in pool if SEP[p][0] == "晚"]
                if len(extra) > need:
                    ok = False
                    break
                chosen = set(extra)
                pool = [p for p in pool if p not in chosen]
            for _i in range(need - len(chosen)):
                wts = [1.0 / (1 + counts[p]) ** 3 for p in pool]
                r = rng.random() * sum(wts)
                acc = 0
                for p, w in zip(pool, wts):
                    acc += w
                    if r <= acc:
                        chosen.add(p)
                        pool.remove(p)
                        break
            late_prev = forced | chosen
            for p in late_prev:
                counts[p] += 1
                late_days[p].append(d)
        if not ok:
            continue
        score = (max(counts.values()) - min(counts.values())) * 1000
        for p in late_days:
            run = 1
            for a, b in zip(late_days[p], late_days[p][1:]):
                run = (run + 1) if b == a + 1 else 1
                score += max(0, run - 3) * 50
        if best is None or score < best[0]:
            best = (score, late_days, counts)
    return best


def duty_reachable(shifts) -> bool:
    """值班可行性：每天早/晚各 1 人，同一人不连值（可达性 DP）"""
    idx = {p: i for i, p in enumerate(SELLERS)}
    early = [tuple(p for p in SELLERS if shifts[p][d - 1] == "早") for d in DAYS]
    late = [tuple(p for p in SELLERS if shifts[p][d - 1] == "晚") for d in DAYS]
    reach = {0}
    for d in DAYS:
        nxt = set()
        for mask in reach:
            for e in early[d - 1]:
                if mask >> idx[e] & 1:
                    continue
                for l in late[d - 1]:
                    if l == e or mask >> idx[l] & 1:
                        continue
                    nxt.add((1 << idx[e]) | (1 << idx[l]))
        if not nxt:
            return False
        reach = nxt
    return True


def mark_after_duty(after_shifts, lead: str):
    """售后值班（浅蓝）：每班只标 1 人。组长在岗 → 他自己（黄）就是值班负责人，早班不再标；
    他休息的日子，早班选 1 人；晚班每天选 1 人（尽量间隔换人、不连值）。"""
    rng = random.Random(33)
    out: dict[tuple[str, int], str] = {}
    count = {p: 0 for p in AFTER if p != lead}
    prev_early = prev_late = None
    for d in DAYS:
        early = [p for p in AFTER if after_shifts[p][d - 1] == "早" and p != lead]
        late = [p for p in AFTER if after_shifts[p][d - 1] == "晚"]
        lead_on = after_shifts[lead][d - 1] != ""
        if not lead_on and early:
            cand = [p for p in early if p != prev_early] or early
            pick = min(cand, key=lambda p: (count[p], rng.random()))
            out[(pick, d)] = "早"
            count[pick] += 1
            prev_early = pick
        if late:
            cand = [p for p in late if p != prev_late] or late
            pick = min(cand, key=lambda p: (count[p], rng.random()))
            out[(pick, d)] = "晚"
            count[pick] += 1
            prev_late = pick
    print("售后值班(浅蓝)次数:", count)
    return out


def mark_duty(shifts):
    """在可行前提下把值班排得尽量均衡、不连值。"""
    idx = {p: i for i, p in enumerate(SELLERS)}
    early = [tuple(p for p in SELLERS if shifts[p][d - 1] == "早") for d in DAYS]
    late = [tuple(p for p in SELLERS if shifts[p][d - 1] == "晚") for d in DAYS]

    @lru_cache(maxsize=None)
    def feasible(d, mask):
        if d > len(DAYS):
            return True
        for e in early[d - 1]:
            if mask >> idx[e] & 1:
                continue
            for l in late[d - 1]:
                if l == e or mask >> idx[l] & 1:
                    continue
                if feasible(d + 1, (1 << idx[e]) | (1 << idx[l])):
                    return True
        return False

    rng = random.Random(7)
    best = None
    for _t in range(3000):
        duty, count, mask = {}, {p: 0 for p in SELLERS}, 0
        ok = True
        for d in DAYS:
            opts = []
            for e in early[d - 1]:
                if mask >> idx[e] & 1:
                    continue
                for l in late[d - 1]:
                    if l == e or mask >> idx[l] & 1:
                        continue
                    nm = (1 << idx[e]) | (1 << idx[l])
                    if feasible(d + 1, nm):
                        opts.append((e, l, nm))
            if not opts:
                ok = False
                break
            rng.shuffle(opts)
            e, l, nm = min(opts, key=lambda o: (count[o[0]] + count[o[1]],
                                                max(count[o[0]], count[o[1]]), rng.random()))
            duty[(e, d)], duty[(l, d)] = "早", "晚"
            count[e] += 1
            count[l] += 1
            mask = nm
        if ok:
            sc = (max(count.values()) - min(count.values())) * 100 + max(count.values())
            if best is None or sc < best[0]:
                best = (sc, duty, count)
    return best[1], best[2]


# ---------------------------------------------------------------- 主流程


def main() -> None:
    ap = argparse.ArgumentParser(description="解排班示例（2026-10 案例）")
    ap.add_argument("--out", default=str(Path("测试数据/2026年10月-计划.json")), help="计划 JSON 输出路径")
    args = ap.parse_args()

    month_days = len(DAYS)
    print("===== 售前 =====")
    errs = []
    for p in SELLERS:
        errs += check_rest(p, SELLER_REST[p], month_days)
    for d in DAYS:
        n = sum(1 for p in SELLERS if d in SELLER_REST[p])
        if n != 1:
            errs.append(f"售前 d{d} 休息人数 {n}")
    print("休息校验:", "全过" if not errs else errs)

    # 晚班 + 值班联合搜索
    rng = random.Random(11)
    best, feasible_cnt = None, 0
    for _trial in range(120000):
        counts = {p: 0 for p in SELLERS}
        late_prev = set(PRE_LATE_SELLER)
        late_days = {p: [] for p in SELLERS}
        ok = True
        for d in DAYS:
            ws_ = [p for p in SELLERS if d not in SELLER_REST[p]]
            forced = late_prev & set(ws_)
            need = 2 - len(forced)
            pool = [p for p in ws_ if p not in forced]
            if need < 0 or need > len(pool):
                ok = False
                break
            chosen = set()
            if d == 1:
                extra = [p for p in pool if SEP[p][0] == "晚"]
                if len(extra) > need:
                    ok = False
                    break
                chosen = set(extra)
                pool = [p for p in pool if p not in chosen]
            for _i in range(need - len(chosen)):
                wts = [1.0 / (1 + counts[p]) ** 3 for p in pool]
                r = rng.random() * sum(wts)
                acc = 0
                for p, w in zip(pool, wts):
                    acc += w
                    if r <= acc:
                        chosen.add(p)
                        pool.remove(p)
                        break
            late_prev = forced | chosen
            for p in late_prev:
                counts[p] += 1
                late_days[p].append(d)
        if not ok:
            continue
        shifts = build_shifts(SELLERS, SELLER_REST, late_days)
        if not duty_reachable(shifts):
            continue
        feasible_cnt += 1
        score = (max(counts.values()) - min(counts.values())) * 1000
        for p in late_days:
            run = 1
            for a, b in zip(late_days[p], late_days[p][1:]):
                run = (run + 1) if b == a + 1 else 1
                score += max(0, run - 3) * 50
        if best is None or score < best[0]:
            best = (score, late_days, counts)
        if feasible_cnt >= 2000:
            break
    assert best, "没有找到能排值班的晚班方案"
    score, late_days, counts = best
    print(f"晚班(值班可行候选 {feasible_cnt} 个):", {p: (late_days[p], counts[p]) for p in late_days})
    seller_shifts = build_shifts(SELLERS, SELLER_REST, late_days)

    duty, duty_count = mark_duty(seller_shifts)
    print("值班次数:", duty_count)

    # 售前自检
    bad = []
    for p in SELLERS:
        seq = seller_shifts[p]
        if SEP[p][0] == "晚" and seq[0] == "早":
            bad.append(f"{p} 上月末晚→本月1号早")
        for d in range(2, month_days + 1):
            if seq[d - 2] == "晚" and seq[d - 1] == "早":
                bad.append(f"{p} d{d} 晚接早")
        run = SEP[p][1]
        for d in DAYS:
            run = run + 1 if seq[d - 1] else 0
            if run > MAX_STREAK:
                bad.append(f"{p} d{d} 连上{run}(含跨月)")
                run = 0
    for d in DAYS:
        e = sum(1 for p in SELLERS if seller_shifts[p][d - 1] == "早")
        l = sum(1 for p in SELLERS if seller_shifts[p][d - 1] == "晚")
        if e != 2 or l != 2:
            bad.append(f"d{d} 售前 {e}早{l}晚")
    print("售前自检:", "全过" if not bad else bad[:6])

    # ---------- 售后：休息搜索 + 晚班 ----------
    print("\n===== 售后 =====")
    nonwork = [d for d in DAYS if d not in LEAD_REST]
    rng = random.Random(20261001)
    best = None
    for _trial in range(60000):
        rest = {p: set(FIXED_REST.get(p, set())) for p in OTHERS}
        for p in OTHERS:
            cand = [d for d in nonwork if d not in rest[p]]
            rng.shuffle(cand)
            for d in cand:
                if len(rest[p]) >= N_REST:
                    break
                if sum(1 for q in OTHERS if d in rest[q]) >= 2:
                    continue
                rest[p].add(d)
        if any(len(rest[p]) != N_REST for p in OTHERS):
            continue
        if any(min(rest[p]) > FIRST_DEADLINE[p] for p in OTHERS):
            continue
        score = 0
        for p in OTHERS:
            ds = sorted(rest[p])
            if SEP[p][1] + ds[0] - 1 > MAX_STREAK:
                score += 100
            for a, b in zip(ds, ds[1:]):
                gap = b - a
                score += 20 if gap == 1 else 0
                score += 10 if gap > 6 else 0
                score += 3 if gap > 5 else 0
            if month_days - ds[-1] > MAX_STREAK:
                score += 50
        if best is None or score < best[0]:
            best = (score, {p: sorted(rest[p]) for p in OTHERS})
    score, after_rest = best
    print("售后休息:", after_rest)
    after_rest_full = dict(after_rest, **{LEAD: LEAD_REST})

    def target_after(d, ws_):
        others = [p for p in ws_ if p != LEAD]
        return min(2, max(1, len(others) - (1 if d not in LEAD_REST else 2)))

    score2, late2, counts2 = solve_lates(AFTER, after_rest_full, PRE_LATE_AFTER,
                                         target_after, forbid=(LEAD,), rounds=60000, seed=22)
    print("售后晚班:", {p: (late2[p], counts2[p]) for p in late2})
    after_shifts = build_shifts(AFTER, after_rest_full, late2, lead=LEAD)

    bad2 = []
    for p in AFTER:
        seq = after_shifts[p]
        if p != LEAD and SEP[p][0] == "晚" and seq[0] == "早":
            bad2.append(f"{p} 上月末晚→本月1号早")
        for d in range(2, month_days + 1):
            if seq[d - 2] == "晚" and seq[d - 1] == "早":
                bad2.append(f"{p} d{d} 晚接早")
        run = SEP[p][1]
        for d in DAYS:
            run = run + 1 if seq[d - 1] else 0
            if run > MAX_STREAK:
                bad2.append(f"{p} d{d} 连上{run}(含跨月)")
                run = 0
    for d in DAYS:
        e = sum(1 for p in AFTER if after_shifts[p][d - 1] == "早")
        l = sum(1 for p in AFTER if after_shifts[p][d - 1] == "晚")
        if e < 2 or l < 1:
            bad2.append(f"d{d} 售后 {e}早{l}晚")
    print("售后自检:", "全过" if not bad2 else bad2[:6])

    after_duty = mark_after_duty(after_shifts, LEAD)
    plan = {"meta": META, "seller": seller_shifts, "after": after_shifts,
            "duty": {f"{p}|{d}": w for (p, d), w in duty.items()},
            "duty_after": {f"{p}|{d}": w for (p, d), w in after_duty.items()}}
    out = Path(args.out)
    out.write_text(json.dumps(plan, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"\n计划已写出: {out}\n下一步: python \"工具\\写排班表.py\" --xlsx <表.xlsx> --plan \"{out}\"")


if __name__ == "__main__":
    main()
