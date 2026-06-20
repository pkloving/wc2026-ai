#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
比分(bf)排除法选分器 — 实现用户策略并回测 ROI。

用户策略:
  1) 先判本场'爆冷不'。
  2) 爆冷: 弱队进球也不大 → 只押'弱队小比分不输'(赢1球内/小平), 排除弱队大胜高总分。
  3) 不爆冷: 绝不跟市场热度 → 押热门赢, 但剔掉最低赔(被超买)的比分, 只取中赔值。
  → 本质是排除法 + 反市场热度。

'爆冷判断'是用户的本事, 回测用三种代理 gate:
  never    : 全按非爆冷处理 (纯反热度, 无未来信息, 最现实下限)
  closecall: 赛前热门赔率>=2.0(均势)才视为可能爆冷 (只用赔率)
  oracle   : 用真实结果(弱队赢=爆冷)做 gate (有未来信息, 仅看天花板)

对照: 全押所有比分 / 只押最热门比分。两届(2022 + 2026已赛)各跑。
参数(hot_k 剔几个热门 / pick_n 取几注 / 总分上限)可调, 见 PARAMS。
"""
import json
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PARAMS = {"hot_k": 2, "pick_n": 3, "fav_total_max": 4,
          "dog_total_max": 3, "dog_goal_max": 2, "close_odds": 2.0}


def pad(h, a):
    return f"{int(h):02d}:{int(a):02d}"


def win_key(h, a, odds):
    k = pad(h, a)
    if k in odds:
        return k
    return "胜其它" if h > a else ("负其它" if h < a else "平其它")


def parse_score(key):
    """'02:01'->(2,1); 兜底键返回 None"""
    if ":" not in key or "其" in key:
        return None
    x, y = key.split(":")
    return int(x), int(y)


def num_odds(odds):
    return {k: v for k, v in odds.items()
            if isinstance(v, (int, float)) and v > 1}


def select(odds, fav_side, is_upset, P):
    """返回要押的比分键列表。fav_side: 'home'/'away'/None"""
    od = num_odds(odds)
    scored = []
    for k, o in od.items():
        sc = parse_score(k)
        if sc is None:
            continue
        h, a = sc
        scored.append((k, o, h, a))
    if fav_side is None:
        fav_side = "home"
    def fav_dog(h, a):
        return (h, a) if fav_side == "home" else (a, h)

    if is_upset:
        # 弱队小比分不输: 弱队赢(margin>=1)且弱队球<=dog_goal_max且总分<=dog_total_max, 或小平
        cand = []
        for k, o, h, a in scored:
            fg, dg = fav_dog(h, a)
            tot = h + a
            if dg > fg and dg <= P["dog_goal_max"] and tot <= P["dog_total_max"]:
                cand.append((k, o))
            elif fg == dg and tot <= 2:
                cand.append((k, o))
        cand.sort(key=lambda x: x[1])         # 最可能的爆冷小比分(低赔)在前
        return [k for k, _ in cand[:P["pick_n"]]]
    # 非爆冷: 热门赢, 剔掉最热, 取中赔
    cand = []
    for k, o, h, a in scored:
        fg, dg = fav_dog(h, a)
        if fg > dg and (h + a) <= P["fav_total_max"]:
            cand.append((k, o))
    cand.sort(key=lambda x: x[1])             # 赔率升序
    keep = cand[P["hot_k"]:]                  # 剔掉最便宜的 hot_k 个
    return [k for k, _ in keep[:P["pick_n"]]]


def load_2022():
    base = os.path.join(ROOT, "2022wc")
    idm = json.load(open(os.path.join(base, "id_map.json")))["matches"]
    out = []
    for mid, m in idm.items():
        if m.get("stage") != "group" or not m.get("full_time_score"):
            continue
        op = os.path.join(base, "odds", f"{mid}.json")
        rp = os.path.join(base, "results", f"{mid}.json")
        if not (os.path.exists(op) and os.path.exists(rp)):
            continue
        o = json.load(open(op))["odds"]
        bf = o.get("bf_latest")
        spf = o.get("spf_latest")
        if not bf or not spf:
            continue
        hg, ag = (int(x) for x in m["full_time_score"].split(":"))
        fav = "home" if spf["home"] < spf["away"] else "away"
        upset = (hg < ag) if fav == "home" else (hg > ag)
        out.append({"odds": bf, "fav": fav, "hg": hg, "ag": ag,
                    "fav_odds": min(spf["home"], spf["away"]),
                    "wk": win_key(hg, ag, bf), "upset": upset})
    return out


def load_2026():
    sd = json.load(open(os.path.join(ROOT, "settled_matches.json")))["matches"]
    out = []
    for m in sd:
        if m.get("league") != "世界杯" or not str(m.get("mid", "")).startswith("204"):
            continue
        bf = (m.get("bf") or {}).get("last") or (m.get("bf") or {}).get("initial")
        spf = (m.get("spf") or {}).get("last") or (m.get("spf") or {}).get("initial")
        rr = m.get("result") or {}
        if not bf or not bf.get("odds") or not spf or rr.get("home") is None:
            continue
        odds = bf["odds"]
        hg, ag = rr["home"], rr["away"]
        fav = "home" if spf["home"] < spf["away"] else "away"
        upset = (hg < ag) if fav == "home" else (hg > ag)
        out.append({"odds": odds, "fav": fav, "hg": hg, "ag": ag,
                    "fav_odds": min(spf["home"], spf["away"]),
                    "wk": win_key(hg, ag, odds), "upset": upset})
    return out


def gate(m, mode):
    if mode == "never":
        return False
    if mode == "oracle":
        return m["upset"]
    if mode == "closecall":
        return m["fav_odds"] >= PARAMS["close_odds"]
    return False


def roi_strategy(rows, mode, P):
    cost = ret = hits = picks = 0
    for m in rows:
        sel = select(m["odds"], m["fav"], gate(m, mode), P)
        picks += len(sel)
        for k in sel:
            cost += 1
            if k == m["wk"]:
                ret += num_odds(m["odds"])[k]
                hits += 1
    roi = (ret - cost) / cost * 100 if cost else 0
    return cost, hits, roi


def baseline_all(rows):
    cost = ret = 0
    for m in rows:
        od = num_odds(m["odds"])
        for k in od:
            cost += 1
            if k == m["wk"]:
                ret += od[k]
    return cost, (ret - cost) / cost * 100 if cost else 0


def baseline_hot(rows):
    cost = ret = hits = 0
    for m in rows:
        od = num_odds(m["odds"])
        scores = [(k, v) for k, v in od.items() if parse_score(k)]
        if not scores:
            continue
        k = min(scores, key=lambda x: x[1])[0]   # 最热比分
        cost += 1
        if k == m["wk"]:
            ret += od[k]
            hits += 1
    return cost, hits, (ret - cost) / cost * 100 if cost else 0


def claims(rows, name):
    # A: 热门比分不赚 (按比分赔率分桶 ROI)
    print(f"\n  [{name}] 前提A 比分按赔率分桶 ROI (验'低赔比分不赚'):")
    bands = [("≤6", 0, 6), ("6-9", 6, 9), ("9-15", 9, 15), ("15-30", 15, 30), ("30+", 30, 9e9)]
    for lab, lo, hi in bands:
        c = ret = h = 0
        for m in rows:
            od = num_odds(m["odds"])
            for k, o in od.items():
                if parse_score(k) and lo <= o < hi:
                    c += 1
                    if k == m["wk"]:
                        ret += o; h += 1
        if c:
            print(f"    赔率{lab:<6}{c:>4}注 中{h:<3} ROI{(ret-c)/c*100:>7.1f}%")
    # B: 爆冷时弱队进球不大
    ups = [m for m in rows if m["upset"]]
    if ups:
        dg = [(m["ag"] if m["fav"] == "home" else m["hg"]) for m in ups]
        tot = [m["hg"] + m["ag"] for m in ups]
        print(f"  [{name}] 前提B 爆冷 {len(ups)} 场: 弱队均进球 {sum(dg)/len(dg):.2f}, "
              f"均总分 {sum(tot)/len(tot):.2f}  (验'弱队进球不大')")


def block(name, rows):
    print("=" * 72)
    print(f"{name}  ({len(rows)} 场)")
    print("=" * 72)
    ca, ra = baseline_all(rows)
    ch, hh, rh = baseline_hot(rows)
    print(f"  对照 全押所有比分 : {ca}注 ROI{ra:>7.1f}%")
    print(f"  对照 只押最热比分 : {ch}注 中{hh} ROI{rh:>7.1f}%")
    print(f"\n  排除法策略 (hot_k={PARAMS['hot_k']}, pick_n={PARAMS['pick_n']}):")
    print(f"    {'爆冷gate':<12}{'注数':>6}{'中':>5}{'ROI':>9}")
    for mode in ("never", "closecall", "oracle"):
        c, h, r = roi_strategy(rows, mode, PARAMS)
        tag = {"never": "从不爆冷", "closecall": "均势=可能冷", "oracle": "oracle(天花板)"}[mode]
        print(f"    {tag:<12}{c:>6}{h:>5}{r:>8.1f}%")
    claims(rows, name)


def main():
    print("比分排除法策略回测  (反市场热度 + 爆冷只押弱队小比分)\n")
    block("2022 世界杯小组赛", load_2022())
    print()
    block("2026 世界杯(已赛)", load_2026())
    print("\n" + "=" * 72)
    print("判读: 看'排除法'是否优于'只押最热比分'(验反热度有没有用);")
    print("      oracle 行=若爆冷判断完全准的天花板; closecall=只靠赔率判断的现实值;")
    print("      bf 是高水位玩法(全押常 -50%), 能把亏损显著收窄就算这套排除法有价值。")
    print("      单/双届小样本, 参数可在 PARAMS 调; 结论需多届验证。")


if __name__ == "__main__":
    main()
