#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
rqspf 高低赔差筛选 (只小组赛)。

思路: rqspf 让球后接近五五开。'高低赔差(max-min)'大 = 市场强烈偏向某让球方
  = 信号明确; 差小 = 让球后真势均, 看不懂 → 该跳。
测: 按赔差阈值筛选, 看
  (1) 下场率(还剩多少场可打) —— 筛得越狠越少;
  (2) 让球热门(最低赔) 命中率 vs 隐含, 押它的 ROI 是否随赔差变大而转正;
  (3) 结果分布(让胜/让平/让负)是否随赔差集中。
样本: 2022 全小组赛 + 2026 已赛小组赛。
"""
import json
import os

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
        out.append({"odds": odds, "act": HHAD[L["HHAD"]["combination"]]})
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
        out.append({"odds": odds, "act": res})
    return out


def analyze(name, rows):
    total = len(rows)
    print("=" * 70)
    print(f"{name}  (共 {total} 场)")
    print("=" * 70)
    for r in rows:
        vals = list(r["odds"].values())
        r["spread"] = max(vals) - min(vals)
        r["fav"] = min(r["odds"], key=r["odds"].get)
    def roi_of(sub, pick):  # pick: 'fav'最低赔 / 'dog'最高赔 / 'draw'
        n = len(sub)
        side = (lambda r: min(r["odds"], key=r["odds"].get)) if pick == "fav" else \
               ((lambda r: max(r["odds"], key=r["odds"].get)) if pick == "dog"
                else (lambda r: "draw"))
        ret = hit = 0
        for r in sub:
            k = side(r)
            if r["act"] == k:
                ret += r["odds"][k]
                hit += 1
        return hit / n, (ret - n) / n * 100

    def dutch(sub, keys_fn):
        """每场押 keys_fn(r) 给出的若干腿各1注; 返回(命中率, ROI)"""
        n = len(sub)
        cost = ret = win = 0
        for r in sub:
            for k in keys_fn(r):
                cost += 1
                if r["act"] == k:
                    ret += r["odds"][k]
                    win += 1
        return (win / n if n else 0), ((ret - cost) / cost * 100 if cost else 0)

    def fav_dog(r):   # 高+低两边, 排除让平
        return [min(r["odds"], key=r["odds"].get), max(r["odds"], key=r["odds"].get)]

    def fav_draw(r):  # 热+平, 排除冷门
        return [min(r["odds"], key=r["odds"].get), "draw"]

    print(f"  {'赔差阈值':<9}{'下场率':>8}{'押热':>7}{'押冷':>7}{'押平':>7}"
          f"{'热+平(中/ROI)':>15}{'高+低两边(中/ROI)':>18}   胜/平/负%")
    for thr in (0.0, 1.0, 1.5, 2.0, 3.0):
        sub = [r for r in rows if r["spread"] >= thr]
        if not sub:
            continue
        n = len(sub)
        _, fr = roi_of(sub, "fav")
        _, dgr = roi_of(sub, "dog")
        _, drr = roi_of(sub, "draw")
        wph, wpr = dutch(sub, fav_draw)
        hlh, hlr = dutch(sub, fav_dog)
        dh = sum(1 for r in sub if r["act"] == "home") / n
        dd = sum(1 for r in sub if r["act"] == "draw") / n
        da = sum(1 for r in sub if r["act"] == "away") / n
        print(f"  ≥{thr:<8.1f}{n}/{total}={n/total:>3.0%}"
              f"{fr:>6.0f}%{dgr:>6.0f}%{drr:>6.0f}%"
              f"{f'{wph:.0%}/{wpr:+.0f}%':>15}{f'{hlh:.0%}/{hlr:+.0f}%':>18}   {dh:.0%}/{dd:.0%}/{da:.0%}")
    print("  (热+平=排冷门; 高+低两边=押让球热门+冷门、排让平; 各按2注成本)")


def main():
    print("rqspf 高低赔差筛选 — 降下场率提 ROI?\n")
    a, b = load_2022(), load_2026()
    analyze("2022 世界杯小组赛", a)
    print()
    analyze("2026 世界杯小组赛(已赛)", b)
    print()
    analyze("合并", a + b)
    print("\n" + "=" * 70)
    print("判读: 若'押热ROI'随赔差阈值升高而上行、并在某阈值后转正(且下场率仍够用),")
    print("      则'只打高赔差 rqspf'是有效筛选; 若一路负 → 让球盘太精, 筛也没肉。")


if __name__ == "__main__":
    main()
