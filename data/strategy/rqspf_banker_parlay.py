#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
串关 = (1+ROI) 相乘的杠杆: 把筛后的 +EV 高命中腿串起来, ROI 会放大吗?

腿 = rqspf 高赔差场的让球热门(最低赔). 已知: 赔差越大→命中越高、单注 ROI 越好(2022)。
测: 同一赔差阈值下, 单注 vs 2串1 vs 3串1 (同日组合), 看 ROI 是否随串数放大。
关键预期: 单注 ROI>0 → 串关相乘后更高; 单注 ROI<0 → 串关相乘后更差(杠杆双向)。
只小组赛, 2022 + 2026。串关需同日多腿, 高阈值下样本会很少, 看趋势。
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
    grp = {str(m["mid"]): m for m in mj
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


def legs_at(rows, thr):
    """筛赔差>=thr, 每场取让球热门腿"""
    legs = []
    for r in rows:
        vals = list(r["odds"].values())
        if max(vals) - min(vals) < thr:
            continue
        fav = min(r["odds"], key=r["odds"].get)
        legs.append({"day": r["day"], "odds": r["odds"][fav],
                     "hit": r["act"] == fav})
    return legs


def parlay_roi(legs, k):
    byday = defaultdict(list)
    for L in legs:
        byday[L["day"]].append(L)
    cost = ret = win = 0
    for ls in byday.values():
        for combo in combinations(ls, k):
            cost += 1
            if all(c["hit"] for c in combo):
                p = 1.0
                for c in combo:
                    p *= c["odds"]
                ret += p
                win += 1
    return cost, win, (ret - cost) / cost * 100 if cost else 0


def block(name, rows):
    print("=" * 70)
    print(f"{name}")
    print("=" * 70)
    print(f"  {'赔差阈值':<9}{'腿数':>5}{'单注ROI':>10}"
          f"{'2串1 注/ROI':>16}{'3串1 注/ROI':>16}")
    for thr in (0.0, 1.5, 2.0, 3.0):
        legs = legs_at(rows, thr)
        if len(legs) < 2:
            continue
        n = len(legs)
        sh = sum(1 for L in legs if L["hit"])
        sret = sum(L["odds"] for L in legs if L["hit"])
        sroi = (sret - n) / n * 100
        c2, w2, r2 = parlay_roi(legs, 2)
        c3, w3, r3 = parlay_roi(legs, 3)
        s2 = f"{c2}/{r2:+.0f}%" if c2 else "-"
        s3 = f"{c3}/{r3:+.0f}%" if c3 else "-"
        print(f"  ≥{thr:<8.1f}{n:>5}{sroi:>9.0f}%{s2:>16}{s3:>16}")
    print("  (单注 ROI>0 时, 串关相乘应更高; <0 时更低 — 验证杠杆双向)")


def main():
    print("串关杠杆: 筛后高命中 +EV 腿 串起来 (rqspf 让球热门)\n")
    block("2022 世界杯小组赛", load_2022())
    print()
    block("2026 世界杯小组赛(已赛)", load_2026())
    print()
    a = load_2022()
    b = load_2026()
    block("合并", a + b)
    print("\n" + "=" * 70)
    print("判读: 串关是【杠杆/放大器】, 不创造 edge —— 它把单腿 ROI 相乘:")
    print("      只有当筛出的单腿真 +EV(且各腿独立)时, 串关才把正 ROI 放大。")
    print("      单腿一负, 串关连乘放大成更负。高阈值同日腿少, 注数很小须谨慎。")


if __name__ == "__main__":
    main()
