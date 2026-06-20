#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
把'高+低两边覆盖腿'(高胜率)放进串关当胆/放大器 — 整体 ROI 怎样?

用户论点: 覆盖腿(押让球热门+冷门、排让平)单看 ROI 没意义, 它是【高胜率的腿】,
  作用是进串关、用高命中去'抬'另一条 +EV 腿。所以要算它【在串关里】的表现。

复式串关数学: 一条腿覆盖 m 个选项 = 该组合拆成 m 注。串关赢 = 各腿都命中其覆盖集。
  覆盖腿的'有效乘数' = 命中率 × (中时平均赔率) / 覆盖注数。<1 则拖累, >1 才放大。

对比 (同日 2串1, rqspf, 赔差>=阈值):
  [clean]     单选热门A × 单选热门B           (1注/组合)
  [胆=覆盖A]  {热A,冷A}两边 × 单选热门B        (2注/组合) ← 用户说的'不下场覆盖腿当胆'
  [双覆盖]    {热A,冷A} × {热B,冷B}            (4注/组合)
看: 命中率(组合中奖率) 与 ROI —— 覆盖抬高命中, 但 ROI 抬还是降?
"""
import json
import os
from itertools import combinations
from collections import defaultdict

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HHAD = {"H": "home", "D": "draw", "A": "away"}
KEYS = ["home", "draw", "away"]


def load_2022():
    base = os.path.join(ROOT, "2022wc")
    idm = json.load(open(os.path.join(base, "id_map.json")))["matches"]
    out = []
    for mid, m in idm.items():
        if m.get("stage") != "group":
            continue
        op = os.path.join(base, "odds", f"{mid}.json")
        rp = os.path.join(base, "results", f"{mid}.json")
        if not (os.path.exists(op) and os.path.exists(rp)):
            continue
        rq = json.load(open(op))["odds"].get("rqspf_latest")
        L = (json.load(open(rp)).get("lottery") or {})
        if not rq or not L.get("HHAD"):
            continue
        odds = {k: rq[k] for k in KEYS if rq.get(k)}
        if len(odds) < 3:
            continue
        out.append({"day": m["kickoff"][:10], "odds": odds,
                    "act": HHAD[L["HHAD"]["combination"]]})
    return out


def load_2026():
    mj = json.load(open(os.path.join(ROOT, "matches.json")))
    grp = {str(m["mid"]) for m in mj
           if m.get("stage") == "group" and str(m.get("mid", "")).startswith("204")}
    sd = json.load(open(os.path.join(ROOT, "settled_matches.json")))["matches"]
    out = []
    for m in sd:
        mid = str(m.get("mid", ""))
        if mid not in grp or m.get("league") != "世界杯":
            continue
        rq = m.get("rqspf") or {}
        last = rq.get("last") or rq.get("initial")
        res = rq.get("result")
        if not last or res not in KEYS:
            continue
        odds = {k: last[k] for k in KEYS if last.get(k)}
        if len(odds) < 3:
            continue
        out.append({"day": (m.get("kickoff") or "")[:10], "odds": odds, "act": res})
    return out


def sel(r, mode):
    """该腿的选项集合"""
    fav = min(r["odds"], key=r["odds"].get)
    dog = max(r["odds"], key=r["odds"].get)
    return [fav] if mode == "single" else [fav, dog]


def parlay(rows, thr, modeA, modeB):
    """同日 2串1, 腿A用modeA腿B用modeB. 返回(组合数, 命中组合数, 注数, ROI)"""
    pool = []
    for r in rows:
        vals = list(r["odds"].values())
        if max(vals) - min(vals) >= thr:
            pool.append(r)
    byday = defaultdict(list)
    for r in pool:
        byday[r["day"]].append(r)
    combos = wins = tickets = 0
    ret = 0.0
    for ls in byday.values():
        for a, b in combinations(ls, 2):
            combos += 1
            sa, sb = sel(a, modeA), sel(b, modeB)
            tickets += len(sa) * len(sb)
            won = False
            for ka in sa:
                for kb in sb:
                    if a["act"] == ka and b["act"] == kb:
                        ret += a["odds"][ka] * b["odds"][kb]
                        won = True
            if won:
                wins += 1
    roi = (ret - tickets) / tickets * 100 if tickets else 0
    return combos, wins, tickets, roi


def block(name, rows):
    print("=" * 78)
    print(f"{name}")
    print("=" * 78)
    print(f"  {'赔差≥':<6}{'结构':<14}{'组合数':>6}{'命中组合':>8}{'命中率':>8}{'注数':>6}{'ROI':>9}")
    for thr in (1.0, 1.5, 2.0):
        for tag, ma, mb in [("clean 单×单", "single", "single"),
                            ("胆=覆盖A×单B", "cover", "single"),
                            ("双覆盖×双覆盖", "cover", "cover")]:
            c, w, t, roi = parlay(rows, thr, ma, mb)
            if c == 0:
                continue
            print(f"  {thr:<6.1f}{tag:<14}{c:>6}{w:>8}{(w/c if c else 0):>7.0%}{t:>6}{roi:>8.1f}%")
        print()


def main():
    print("覆盖腿当胆放进串关 — 高命中能否抬住整体 ROI?\n")
    block("2022 世界杯小组赛", load_2022())
    block("2026 世界杯小组赛(已赛)", load_2026())
    print("=" * 78)
    print("判读: '命中率'列覆盖结构应明显更高(高胜率腿生效); 但比 ROI:")
    print("      覆盖腿有效乘数<1时, 它抬命中却【拉低】串关ROI(稀释), 不是放大;")
    print("      只有当覆盖腿本身≈或>盈亏平衡时, 它才在串关里既稳又不拖累。")


if __name__ == "__main__":
    main()
