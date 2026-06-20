#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
比赛原型分类器 — '认知筛选'框架: 把比赛归类, 只买信号明确(结果集中)的原型。

两轴:
  强弱轴 = spf 最低赔(热门强度): 强打弱(<1.5) / 中等(1.5-2.2) / 均势(>=2.2)
  进球轴 = zjq 去水位的隐含均进球: 防守型(<2.4) / 中(2.4-2.8) / 大球型(>=2.8)
  9 个原型。每个原型看:
    结果分布(热门胜/平/冷门胜)、可读度(最大那一类占比, 越高越好读)、
    场均球、押热/平/冷的 spf ROI、Top实际比分。
另叠'爆冷'是情境而非赛前类型(R2/R3 养生局, 见 fade_public_by_round)。
样本: 2022 全小组赛 + 2026 已赛小组赛。
"""
import json
import os
from collections import defaultdict, Counter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def exp_goals(zjq):
    od = {k: v for k, v in zjq.items() if isinstance(v, (int, float)) and v > 1}
    if not od:
        return None
    inv = {k: 1 / v for k, v in od.items()}
    s = sum(inv.values())
    e = 0.0
    for k, p in inv.items():
        n = 7 if "7" in k else int(k)
        e += (p / s) * n
    return e


def strength(fav_odds):
    return "强打弱" if fav_odds < 1.5 else ("均势" if fav_odds >= 2.2 else "中等")


def goalcat(e):
    return "防守型" if e < 2.4 else ("大球型" if e >= 2.8 else "中球")


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
        o = json.load(open(op))["odds"]
        spf, zjq = o.get("spf_latest"), o.get("zjq_latest")
        if not spf or not zjq:
            continue
        e = exp_goals(zjq)
        if e is None:
            continue
        hg, ag = (int(x) for x in m["full_time_score"].split(":"))
        out.append(_row(spf, e, hg, ag))
    return out


def load_2026():
    sd = json.load(open(os.path.join(ROOT, "settled_matches.json")))["matches"]
    mids_group = set()
    mj = json.load(open(os.path.join(ROOT, "matches.json")))
    for m in mj:
        if m.get("stage") == "group" and str(m.get("mid", "")).startswith("204"):
            mids_group.add(str(m["mid"]))
    out = []
    for m in sd:
        mid = str(m.get("mid", ""))
        if mid not in mids_group or m.get("league") != "世界杯":
            continue
        sp = (m.get("spf") or {}).get("last") or (m.get("spf") or {}).get("initial")
        zj = (m.get("zjq") or {}).get("last", {}).get("odds") or \
             (m.get("zjq") or {}).get("initial", {}).get("odds")
        rr = m.get("result") or {}
        if not sp or not zj or rr.get("home") is None:
            continue
        e = exp_goals(zj)
        if e is None:
            continue
        out.append(_row({"home": sp["home"], "draw": sp["draw"], "away": sp["away"]},
                        e, rr["home"], rr["away"]))
    return out


def _row(spf, e, hg, ag):
    fav = "home" if spf["home"] < spf["away"] else "away"
    res = "home" if hg > ag else ("away" if ag > hg else "draw")
    outcome = "热" if res == fav else ("平" if res == "draw" else "冷")
    return {"spf": spf, "fav": fav, "fav_odds": min(spf["home"], spf["away"]),
            "e": e, "hg": hg, "ag": ag, "res": res, "outcome": outcome,
            "arch": (strength(min(spf["home"], spf["away"])), goalcat(e)),
            "score": f"{min(hg,9)}:{min(ag,9)}" if fav == "home" else f"{min(ag,9)}:{min(hg,9)}"}
            # score 统一成 热门视角 (热门进球:冷门进球), 便于跨场看形态


def roi_side(rows, side):
    cost = ret = hit = 0
    for r in rows:
        k = r["fav"] if side == "热" else ("draw" if side == "平"
                                           else ({"home": "away", "away": "home"}[r["fav"]]))
        cost += 1
        if r["res"] == k:
            ret += r["spf"][k]
            hit += 1
    return (ret - cost) / cost * 100 if cost else 0


def block(name, rows):
    print("=" * 92)
    print(f"{name}  ({len(rows)} 场)")
    print("=" * 92)
    print(f"  {'原型':<16}{'n':>3}{'热胜%':>7}{'平%':>6}{'冷胜%':>7}{'均球':>6}"
          f"{'可读':>6}{'押热':>8}{'押平':>8}{'押冷':>8}  Top比分(热视角)")
    by = defaultdict(list)
    for r in rows:
        by[r["arch"]].append(r)
    order = [(s, g) for s in ("强打弱", "中等", "均势")
             for g in ("防守型", "中球", "大球型")]
    for arch in order:
        sub = by.get(arch, [])
        if not sub:
            continue
        n = len(sub)
        fw = sum(1 for r in sub if r["outcome"] == "热") / n
        dr = sum(1 for r in sub if r["outcome"] == "平") / n
        cw = sum(1 for r in sub if r["outcome"] == "冷") / n
        g = sum(r["hg"] + r["ag"] for r in sub) / n
        read = max(fw, dr, cw)
        top = Counter(r["score"] for r in sub).most_common(2)
        tops = " ".join(f"{s}×{c}" for s, c in top)
        tag = "★好读" if read >= 0.55 else ("·中" if read >= 0.45 else "✗噪声")
        print(f"  {arch[0]+'+'+arch[1]:<14}{n:>3}{fw:>6.0%}{dr:>5.0%}{cw:>6.0%}{g:>6.2f}"
              f"{read:>5.0%}{tag[:2]}{roi_side(sub,'热'):>6.0f}%{roi_side(sub,'平'):>7.0f}%"
              f"{roi_side(sub,'冷'):>7.0f}%  {tops}")


def main():
    a, b = load_2022(), load_2026()
    block("2022 世界杯小组赛", a)
    print()
    block("2026 世界杯小组赛(已赛)", b)
    print()
    block("合并", a + b)
    print("\n" + "=" * 92)
    print("用法: '可读'列 ★(最大结果占比≥55%)= 信号明确该重点看; ✗(<45%)= 看不懂该跳过。")
    print("      再用 Top比分 + 押热/平/冷ROI 决定在好读原型里押哪边/哪些比分。")
    print("      '爆冷'不是赛前原型而是情境(R2/R3养生局), 单列在 fade_public_by_round。单届小样本。")


if __name__ == "__main__":
    main()
