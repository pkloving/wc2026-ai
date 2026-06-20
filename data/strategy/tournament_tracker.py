#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
2026 赛事指纹滚动追踪器 (可随时重跑, 数据越多越准)。

理念: 不找跨届铁律, 而是【读出本届脾气、顺势押下一轮】。并把"玄学=没纳入的变量"
落地为可检验的【环境维度】(高海拔/高温/温和), 检验举办地气候是否驱动进球与赛果。
  2022 卡塔尔: 冬季/单城/空调/零旅行 → 环境零方差 (做基准)。
  2026 美加墨: 夏季/三国/跨时区/有墨西哥城高海拔与南部高温 → 环境高方差。

输出:
  [1] 本届当前指纹 (总+按轮次) vs 2022 基准
  [2] 环境拆分: 不同气候球场的 场均球/冷门率/平局率
  [3] 下一轮顺势倾向 (基于累计脾气, 标注样本可信度)
  [4] 前瞻记分: 已有'前轮读数→后轮结果'的轮次, 自动结算读数对不对
再跑: python3 data/tournament_tracker.py
"""
import json
import os
from collections import defaultdict

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# 场馆环境标签 (注: 部分为封顶/空调球场, 会削弱高温效应, 已在判读注明)
ALT = {"Mexico City", "Guadalajara"}                       # 高海拔
HEAT = {"Miami", "Houston", "Monterrey", "Kansas City",    # 高温/高湿区
        "Arlington", "Atlanta", "Dallas"}


def env_of(venue):
    v = venue or ""
    for city in ALT:
        if city in v:
            return "高海拔"
    for city in HEAT:
        if city in v:
            return "高温湿"
    return "温和"


def devig(h, d, a):
    inv = [1 / h, 1 / d, 1 / a]
    s = sum(inv)
    return dict(zip(["home", "draw", "away"], [x / s for x in inv]))


def mkrow(h, d, a, res, goals, rnd, venue):
    try:
        h, d, a = float(h), float(d), float(a)
    except (TypeError, ValueError):
        return None
    if min(h, d, a) <= 1:
        return None
    outs = {"home": h, "draw": d, "away": a}
    fav = min(outs, key=outs.get)
    dog = max(outs, key=outs.get)
    return {"res": res, "fav": fav, "dog": dog, "odds": outs,
            "p": devig(h, d, a), "goals": goals, "rnd": rnd,
            "env": env_of(venue)}


def round_map_2026():
    mj = json.load(open(os.path.join(ROOT, "matches.json")))
    g = defaultdict(list)
    meta = {}
    for m in mj:
        if m.get("stage") == "group" and str(m.get("mid", "")).startswith("204"):
            g[m["group"]].append(m)
            meta[str(m["mid"])] = m.get("venue")
    rnd = {}
    for grp, mm in g.items():
        mm.sort(key=lambda x: x["date"])
        for i, m in enumerate(mm):
            rnd[str(m["mid"])] = i // 2 + 1
    return rnd, meta


def load_2026():
    rnd, ven = round_map_2026()
    sd = json.load(open(os.path.join(ROOT, "settled_matches.json")))["matches"]
    rows = []
    for m in sd:
        mid = str(m.get("mid", ""))
        if mid not in rnd or m.get("league") != "世界杯":
            continue
        spf = m.get("spf") or {}
        last = spf.get("last") or spf.get("initial")
        res = spf.get("result")
        if not last or res not in ("home", "draw", "away"):
            continue
        rr = m.get("result") or {}
        goals = (rr.get("home") or 0) + (rr.get("away") or 0)
        r = mkrow(last.get("home"), last.get("draw"), last.get("away"),
                  res, goals, rnd[mid], ven.get(mid))
        if r:
            rows.append(r)
    return rows


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
        rd = (int(m["label"].rsplit("-", 1)[1][1:]) - 1) // 2 + 1
        r = mkrow(spf["home"], spf["draw"], spf["away"], res, hg + ag, rd, None)
        if r:
            rows.append(r)
    return rows


def fp(rows):
    """指纹: 返回各项 兑现率/定价/超额, 和场均球。"""
    n = len(rows)
    if not n:
        return None
    def cover(side):
        act = sum(1 for r in rows if r["res"] == r[side]) / n
        imp = sum(r["p"][r[side]] for r in rows) / n
        return act, imp
    fa, fi = cover("fav")
    da, di = cover("dog")
    dra = sum(1 for r in rows if r["res"] == "draw") / n
    dri = sum(r["p"]["draw"] for r in rows) / n
    return {"n": n, "goals": sum(r["goals"] for r in rows) / n,
            "fav": (fa, fi), "dog": (da, di), "draw": (dra, dri)}


def show_fp(label, f):
    if not f:
        print(f"  {label:<16} (无数据)")
        return
    print(f"  {label:<16} n={f['n']:<3} 场均球 {f['goals']:.2f}")
    for k, cn in [("fav", "热门"), ("dog", "冷门"), ("draw", "平局")]:
        a, i = f[k]
        print(f"      {cn} 兑现{a:>4.0%}  定价{i:>4.0%}  超额{a-i:>+4.0%}")


def lean(rows):
    """基于累计脾气给下一轮顺势倾向 + 可信度。"""
    f = fp(rows)
    if not f or f["n"] < 6:
        return "样本太少(<6场), 不发倾向。"
    de = f["dog"][0] - f["dog"][1]      # 冷门超额
    dre = f["draw"][0] - f["draw"][1]   # 平局超额
    go = f["goals"]
    conf = "弱" if f["n"] < 16 else ("中" if f["n"] < 32 else "较强")
    msgs = []
    if de >= 0.05:
        msgs.append(f"本届偏【爱爆冷】(冷门超额{de:+.0%}) → 下一轮可试探押冷/防热门")
    elif de <= -0.05:
        msgs.append(f"本届偏【热门稳】(冷门超额{de:+.0%}) → 下一轮别追冷门")
    else:
        msgs.append(f"冷热接近定价({de:+.0%}) → 无明显冷热倾向")
    if dre >= 0.06:
        msgs.append(f"平局被低估({dre:+.0%}) → 均势场可考虑押/盖平")
    elif dre <= -0.06:
        msgs.append(f"平局偏少({dre:+.0%}) → 别押平")
    msgs.append(f"场均球 {go:.2f} → {'偏大球(总进球/比分上调)' if go>2.7 else ('偏小球' if go<2.3 else '中性')}")
    return f"[可信度:{conf}] " + " ; ".join(msgs)


def main():
    a22 = load_2022()
    r26 = load_2026()
    print("=" * 70)
    print("2026 赛事指纹滚动追踪器")
    print("=" * 70)

    print("\n[1] 指纹对比 (2022 基准 vs 2026 当前)\n")
    show_fp("2022 全小组赛", fp(a22))
    print()
    show_fp("2026 累计", fp(r26))
    for rd in (1, 2, 3):
        sub = [r for r in r26 if r["rnd"] == rd]
        if sub:
            show_fp(f"2026 第{rd}轮", fp(sub))

    print("\n[2] 环境维度 (验'气候影响赛果'假设) — 2026 各类球场\n")
    print(f"  {'环境':<8}{'场数':>5}{'场均球':>8}{'冷门率':>8}{'平局率':>8}")
    byenv = defaultdict(list)
    for r in r26:
        byenv[r["env"]].append(r)
    for env in ("高海拔", "高温湿", "温和"):
        s = byenv.get(env, [])
        if not s:
            print(f"  {env:<8}{0:>5}")
            continue
        g = sum(x["goals"] for x in s) / len(s)
        cold = sum(1 for x in s if x["res"] == x["dog"]) / len(s)
        dr = sum(1 for x in s if x["res"] == "draw") / len(s)
        print(f"  {env:<8}{len(s):>5}{g:>8.2f}{cold:>7.0%}{dr:>7.0%}")
    print("  注: SoFi/AT&T/亚特兰大/休斯顿等为封顶/空调球场, 会削弱高温效应; 样本小仅看趋势。")

    print("\n[3] 下一轮顺势倾向 (基于 2026 累计脾气)\n")
    print("  " + lean(r26))

    print("\n[4] 前瞻记分 (读数→后轮结果, 自动结算)\n")
    done = sorted({r["rnd"] for r in r26})
    if len(done) < 2:
        print(f"  目前仅完成第 {done} 轮。等第2轮结果到位, 即可用'第1轮读数'结算第2轮,")
        print("  形成 2022 之外的独立前瞻验证。届时本节自动出分。")
    else:
        for rd in done[1:]:
            prior = [r for r in r26 if r["rnd"] < rd]
            cur = [r for r in r26 if r["rnd"] == rd]
            pe = fp(prior)["dog"]
            lean_cold = (pe[0] - pe[1]) >= 0.05
            ce = fp(cur)["dog"]
            cur_cold_over = (ce[0] - ce[1]) > 0
            ok = (lean_cold == cur_cold_over)
            print(f"  第{rd}轮: 前轮读数{'偏冷' if lean_cold else '不偏冷'} | "
                  f"本轮实际冷门{'超额' if cur_cold_over else '不足'} → "
                  f"{'✅读对' if ok else '❌读错'}")

    print("\n" + "=" * 70)
    print("说明: 这是方法工具, 不是已验证策略。每轮赛后重跑, 看 2026 脾气是否")
    print("      早轮可读、后轮持续, 以及环境拆分是否随数据变清晰。")


if __name__ == "__main__":
    main()
