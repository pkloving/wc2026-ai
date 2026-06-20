#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
串高概率单注 vs 串高赔 — 哪个 ROI 好?

用户论点: 不堆高赔, 而是只串'高概率、有信号、几乎必中'的低赔腿, 用高命中把多腿串中。
理论: 串关 ROI = 各腿 (1+ROI) 连乘。热门-冷门偏差下:
  · 高概率热门腿(低赔) = 被低估/公道 → 每腿 EV 较好 → 串它=乘正;
  · 高赔冷门腿 = 被高估 → 每腿 EV 差 → 串它=乘负。
故'串高概率'应优于'串高赔'。

测 (spf 原盘, 小组赛): 把'热门腿'按强度(热门赔率)分桶, 各跑 单注/2串1/3串1;
  另列'串冷门'(每场押最高赔)作反面对照。看命中率与 ROI。
"""
import json
import os
from itertools import combinations
from collections import defaultdict

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def load_2022():
    base = os.path.join(ROOT, "2022wc")
    idm = json.load(open(os.path.join(base, "id_map.json")))["matches"]
    out = []
    for mid, m in idm.items():
        if m.get("stage") != "group" or not m.get("full_time_score"):
            continue
        op = os.path.join(base, "odds", f"{mid}.json")
        if not os.path.exists(op):
            continue
        spf = json.load(open(op))["odds"].get("spf_latest")
        if not spf:
            continue
        hg, ag = (int(x) for x in m["full_time_score"].split(":"))
        res = "home" if hg > ag else ("away" if ag > hg else "draw")
        out.append({"day": m["kickoff"][:10], "spf": spf, "res": res})
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
        sp = (m.get("spf") or {}).get("last") or (m.get("spf") or {}).get("initial")
        res = (m.get("spf") or {}).get("result")
        if not sp or res not in ("home", "draw", "away"):
            continue
        out.append({"day": (m.get("kickoff") or "")[:10],
                    "spf": {"home": sp["home"], "draw": sp["draw"], "away": sp["away"]},
                    "res": res})
    return out


def leg_fav(r):
    k = min(r["spf"], key=r["spf"].get)
    return {"day": r["day"], "k": k, "odds": r["spf"][k], "hit": r["res"] == k}


def leg_dog(r):
    k = max(r["spf"], key=r["spf"].get)
    return {"day": r["day"], "k": k, "odds": r["spf"][k], "hit": r["res"] == k}


def parlay(legs, n):
    byday = defaultdict(list)
    for L in legs:
        byday[L["day"]].append(L)
    combos = wins = 0
    ret = 0.0
    for ls in byday.values():
        for combo in combinations(ls, n):
            combos += 1
            if all(c["hit"] for c in combo):
                p = 1.0
                for c in combo:
                    p *= c["odds"]
                ret += p
                wins += 1
    roi = (ret - combos) / combos * 100 if combos else 0
    return combos, wins, roi


def fmt(legs, n):
    c, w, roi = parlay(legs, n)
    if c == 0:
        return "       -"
    return f"{w}/{c}={w/c:.0%},{roi:+.0f}%"


def block(name, rows):
    print("=" * 80)
    print(f"{name}  ({len(rows)} 场)")
    print("=" * 80)
    print(f"  {'腿(热门赔率档)':<18}{'腿数':>5}{'单注命中/ROI':>15}"
          f"{'2串1命中/ROI':>16}{'3串1命中/ROI':>16}")
    bands = [("超强热≤1.3", 0, 1.3), ("强热1.3-1.5", 1.3, 1.5),
             ("中热1.5-1.8", 1.5, 1.8), ("弱热1.8-2.2", 1.8, 2.2),
             ("全部热门", 0, 99)]
    for tag, lo, hi in bands:
        legs = [leg_fav(r) for r in rows if lo <= leg_fav(r)["odds"] < hi]
        if len(legs) < 1:
            continue
        n = len(legs)
        sh = sum(1 for L in legs if L["hit"])
        sret = sum(L["odds"] for L in legs if L["hit"])
        sroi = (sret - n) / n * 100
        print(f"  {tag:<16}{n:>5}{f'{sh}/{n}={sh/n:.0%},{sroi:+.0f}%':>15}"
              f"{fmt(legs,2):>16}{fmt(legs,3):>16}")
    # 反面对照: 串冷门
    dogs = [leg_dog(r) for r in rows]
    n = len(dogs)
    sh = sum(1 for L in dogs if L["hit"])
    sret = sum(L["odds"] for L in dogs if L["hit"])
    sroi = (sret - n) / n * 100
    print(f"  {'[对照]串冷门':<16}{n:>5}{f'{sh}/{n}={sh/n:.0%},{sroi:+.0f}%':>15}"
          f"{fmt(dogs,2):>16}{fmt(dogs,3):>16}")


def main():
    print("串高概率单注(低赔热门) vs 串高赔(冷门) — ROI 对比\n")
    a, b = load_2022(), load_2026()
    block("2022 世界杯小组赛", a)
    print()
    block("2026 世界杯小组赛(已赛)", b)
    print()
    block("合并", a + b)
    print("\n" + "=" * 80)
    print("判读: 若'串热门'(尤其强热)ROI 明显优于'串冷门', 印证'串高概率正EV腿'>'串高赔负EV腿'。")
    print("      但热门腿本身 +EV 与否随年景翻转, 仍需本届指纹确认; 单/双届小样本看方向。")


if __name__ == "__main__":
    main()
