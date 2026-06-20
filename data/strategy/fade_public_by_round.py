#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
fade the public × 多轮心态修正 (只用小组赛)。

前一脚本发现: 跟买'大众侧'(名门/热门)两届稳亏, 但无脑反买对面不稳(随年景翻转)。
本脚本叠加【轮次 + 出线心态】: 假设大众侧真正崩的地方在 R2/R3, 尤其
  '大众侧已基本出线(≥4分)→ 养生轮换' 时, 反买其对手(常被低估)才稳。

大众侧定义: 有且仅一支名门则=名门侧; 否则=最低赔热门侧。
心态修正: 用 R<本轮 重建积分, 标注大众侧赛前积分 → 是否'已稳/养生'。
结算: spf 原盘, 反买大众侧对手。2022 全程; 2026 目前主要 R1。
"""
import json
import os
from collections import defaultdict

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
GLAM = {"巴西", "阿根廷", "德国", "英格兰", "法国", "西班牙", "葡萄牙", "荷兰", "比利时"}
OPP = {"home": "away", "away": "home"}


def fav_side(spf):
    return "home" if spf["home"] < spf["away"] else "away"


def public_side(home, away, spf):
    h, a = home in GLAM, away in GLAM
    if h and not a:
        return "home"
    if a and not h:
        return "away"
    return fav_side(spf)


def load_2022():
    base = os.path.join(ROOT, "2022wc")
    idm = json.load(open(os.path.join(base, "id_map.json")))["matches"]
    rows = []
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
        rows.append({"grp": m["group"],
                     "rnd": (int(m["label"].rsplit("-", 1)[1][1:]) - 1) // 2 + 1,
                     "home": m["home"], "away": m["away"], "hg": hg, "ag": ag,
                     "spf": spf, "res": res})
    return rows


def load_2026():
    mj = json.load(open(os.path.join(ROOT, "matches.json")))
    g = defaultdict(list)
    info = {}
    for m in mj:
        if m.get("stage") == "group" and str(m.get("mid", "")).startswith("204"):
            g[m["group"]].append(m)
    rnd = {}
    for grp, mm in g.items():
        mm.sort(key=lambda x: x["date"])
        for i, m in enumerate(mm):
            rnd[str(m["mid"])] = (grp, i // 2 + 1)
    sd = json.load(open(os.path.join(ROOT, "settled_matches.json")))["matches"]
    rows = []
    for m in sd:
        mid = str(m.get("mid", ""))
        if mid not in rnd or m.get("league") != "世界杯":
            continue
        sp = m.get("spf") or {}
        last = sp.get("last") or sp.get("initial")
        res = sp.get("result")
        rr = m.get("result") or {}
        if not last or res not in ("home", "draw", "away"):
            continue
        grp, rd = rnd[mid]
        rows.append({"grp": grp, "rnd": rd, "home": m["home"], "away": m["away"],
                     "hg": rr.get("home", 0), "ag": rr.get("away", 0),
                     "spf": {"home": last["home"], "draw": last["draw"], "away": last["away"]},
                     "res": res})
    return rows


def standings_before(rows, grp, rnd):
    pts = defaultdict(int)
    for r in rows:
        if r["grp"] != grp or r["rnd"] >= rnd:
            continue
        if r["res"] == "home":
            pts[r["home"]] += 3
        elif r["res"] == "away":
            pts[r["away"]] += 3
        else:
            pts[r["home"]] += 1
            pts[r["away"]] += 1
    return pts


def roi(bets):
    cost = len(bets)
    ret = sum(o for w, o in bets if w)
    h = sum(1 for w, _ in bets if w)
    return cost, h, (ret - cost) / cost * 100 if cost else 0


def line(label, bets):
    c, h, r = roi(bets)
    if c:
        print(f"    {label:<28}{h}/{c:<3} ROI {r:+.1f}%")
    else:
        print(f"    {label:<28}(无样本)")


def block(name, rows):
    print("=" * 64)
    print(f"{name}  ({len(rows)} 场)")
    print("=" * 64)
    # 给每场标 大众侧 + (R2/R3)大众侧赛前积分
    for r in rows:
        r["pub"] = public_side(r["home"], r["away"], r["spf"])
        r["pub_team"] = r["home"] if r["pub"] == "home" else r["away"]
        if r["rnd"] >= 2:
            pts = standings_before(rows, r["grp"], r["rnd"])
            r["pub_pts"] = pts.get(r["pub_team"], 0)
        else:
            r["pub_pts"] = None

    print("\n  跟买大众侧 vs 反买对手 — 按轮次:")
    for rd in (1, 2, 3):
        sub = [r for r in rows if r["rnd"] == rd]
        if not sub:
            continue
        back = [(r["res"] == r["pub"], r["spf"][r["pub"]]) for r in sub]
        fade = [(r["res"] == OPP[r["pub"]], r["spf"][OPP[r["pub"]]]) for r in sub]
        cb, hb, rb = roi(back)
        cf, hf, rf = roi(fade)
        print(f"    R{rd} ({len(sub)}场): 跟买 {rb:+6.1f}%(中{hb}) | 反买 {rf:+6.1f}%(中{hf})")

    print("\n  心态修正 — R2/R3 反买'大众侧对手', 按大众侧赛前积分:")
    r23 = [r for r in rows if r["rnd"] >= 2 and r["pub_pts"] is not None]
    safe = [r for r in r23 if r["pub_pts"] >= 4]       # 大众侧已基本出线=养生
    mid = [r for r in r23 if 2 <= r["pub_pts"] <= 3]
    needy = [r for r in r23 if r["pub_pts"] <= 1]       # 大众侧还很需要分
    line("大众侧已稳(≥4分)→反买对手", [(r["res"] == OPP[r["pub"]], r["spf"][OPP[r["pub"]]]) for r in safe])
    line("大众侧中间(2-3分)→反买", [(r["res"] == OPP[r["pub"]], r["spf"][OPP[r["pub"]]]) for r in mid])
    line("大众侧需分(≤1分)→反买", [(r["res"] == OPP[r["pub"]], r["spf"][OPP[r["pub"]]]) for r in needy])


def main():
    print("fade the public × 多轮心态修正 (仅小组赛)\n")
    a = load_2022()
    b = load_2026()
    block("2022 世界杯小组赛", a)
    print()
    block("2026 世界杯小组赛(已赛)", b)
    print()
    block("合并 2022+2026", a + b)
    print("\n" + "=" * 64)
    print("判读: 大众侧 fade 是否在 R2/R3、尤其'大众侧已稳(养生)'子集里才转正且两年同向。")
    print("      若是 → '反向去除' 要叠轮次+心态才稳, 不能场场反。样本极小, 仅探索。")


if __name__ == "__main__":
    main()
