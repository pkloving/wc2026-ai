#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
每日出单合并报告: 31规则出单 + 新策略出单, 并到一份 markdown。

用法:
  python3 data/daily_dual_report.py 2026-06-20
  (读 modeling/artifacts/predict_31_<最近>.json, 取 kickoff 该日的场; 写 + 打印合并报告)

新策略 = 本轮调查闭环:
  原型(强弱轴spf×进球轴zjq) + 本届指纹(regime) + R2/R3出线心态 → 信心分级与出单;
  串关 = 仅当≥2条★正EV腿且本届热门在兑现时 clean 串, 否则单注/跳过。
所有规律来自 2022全程+2026在赛, 小样本; 报告内含诚实刹车。
"""
import json
import os
import sys
import glob
from collections import defaultdict

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WCROOT = ROOT  # data/
MODEL = os.path.join(ROOT, "..", "modeling", "artifacts")


# ---------- 数据加载 ----------
def latest_predict():
    fs = sorted(glob.glob(os.path.join(MODEL, "predict_31_*.json")))
    return fs[-1] if fs else None


def load_odds(mid):
    p = os.path.join(WCROOT, "odds", f"{mid}.json")
    if not os.path.exists(p):
        return {}
    return json.load(open(p)).get("odds", {})


def exp_goals(zjq):
    if not zjq:
        return None
    od = {k: v for k, v in zjq.items() if isinstance(v, (int, float)) and v > 1}
    if not od:
        return None
    inv = {k: 1 / v for k, v in od.items()}
    s = sum(inv.values())
    return sum((p / s) * (7 if "7" in k else int(k)) for k, p in inv.items())


def round_map():
    mj = json.load(open(os.path.join(WCROOT, "matches.json")))
    g = defaultdict(list)
    for m in mj:
        if m.get("stage") == "group" and str(m.get("mid", "")).startswith("204"):
            g[m["group"]].append(m)
    rnd, grp = {}, {}
    for gk, ms in g.items():
        ms.sort(key=lambda x: x["date"])
        for i, m in enumerate(ms):
            rnd[str(m["mid"])] = i // 2 + 1
            grp[str(m["mid"])] = gk
    return rnd, grp


def standings_and_regime():
    """重建各队 R1后积分 + 本届指纹(场均球/热门兑现/平局率)。"""
    sd = json.load(open(os.path.join(WCROOT, "settled_matches.json")))["matches"]
    rnd, _ = round_map()
    pts, gd = defaultdict(int), defaultdict(int)
    goals = fav_hit = fav_imp = draws = n = 0
    for m in sd:
        mid = str(m.get("mid", ""))
        if m.get("league") != "世界杯" or mid not in rnd:
            continue
        rr = m.get("result") or {}
        h, a = rr.get("home"), rr.get("away")
        if h is None:
            continue
        hm, am = m["home"], m["away"]
        # 积分(仅R1, 供R2心态)
        if rnd[mid] == 1:
            if h > a:
                pts[hm] += 3
            elif a > h:
                pts[am] += 3
            else:
                pts[hm] += 1; pts[am] += 1
            gd[hm] += h - a; gd[am] += a - h
        # 指纹(全部已赛)
        sp = (m.get("spf") or {}).get("last") or (m.get("spf") or {}).get("initial")
        res = (m.get("spf") or {}).get("result")
        if sp and res in ("home", "draw", "away"):
            n += 1
            goals += h + a
            inv = {k: 1 / sp[k] for k in ("home", "draw", "away")}
            s = sum(inv.values())
            fav = min(("home", "draw", "away"), key=lambda k: sp[k])
            fav_imp += inv[fav] / s
            if res == fav:
                fav_hit += 1
            if res == "draw":
                draws += 1
    regime = {"n": n, "gpg": goals / n if n else 0,
              "fav_hit": fav_hit / n if n else 0, "fav_imp": fav_imp / n if n else 0,
              "draw": draws / n if n else 0}
    return pts, gd, regime


# ---------- 新策略核心 ----------
def is_rq_slim(m, primary):
    """复刻 strategy_core.isRqSlim (5 OR + G 规则 2026-06-20 新增)
    返回 True=单选, False=双选
    """
    if not m or not primary:
        return False
    hc = m.get("handicap")
    if hc == 1:                                  # G: 主受让+1 强制 DUAL
        return False
    if primary.get("d") == "home":               # A: 主选=让胜
        return True
    spf = m.get("spf") or {}
    if spf.get("home") and spf["home"] < 1.3:    # B: spf 大热门
        return True
    if hc is not None and abs(hc) == 2:          # D: 大让球
        return True
    if hc == -1 and spf.get("home") and spf["home"] < 1.5:  # E: 强让
        return True
    if hc == 1 and spf.get("away") and spf["away"] < 1.5:  # F: 反向强让 (被 G 覆盖)
        return True
    return False


def strength(spf, rqspf, hc):
    if spf and spf.get("home") and spf.get("away"):
        fo = min(spf["home"], spf["away"])
        side = "home" if spf["home"] < spf["away"] else "away"
    elif rqspf:  # spf 缺失, 用让球+rqspf 推
        side = "home" if hc is not None and hc < 0 else "away"
        fo = None
    else:
        return None, None, None
    if fo is None:
        lvl = "强打弱" if (hc is not None and abs(hc) >= 2) else "中等"
    else:
        lvl = "超强" if fo <= 1.3 else ("强打弱" if fo < 1.5 else ("中等" if fo < 2.2 else "均势"))
    return lvl, side, fo


def goalcat(e):
    if e is None:
        return "?"
    return "防守型" if e < 2.4 else ("大球型" if e >= 2.8 else "中球")


def cheap_scores(bf, want_fav_side, n=4, min_total=2, low=False):
    """按 fav 视角选比分: low=True 选小分簇; 否则选热门赢且总分>=min_total"""
    if not bf:
        return []
    items = []
    for k, v in bf.items():
        if ":" not in k or "其" in k or not isinstance(v, (int, float)) or v <= 1:
            continue
        h, a = (int(x) for x in k.split(":"))
        fg, dg = (h, a) if want_fav_side == "home" else (a, h)
        items.append((k, v, fg, dg, h + a))
    items.sort(key=lambda x: x[1])
    out = []
    for k, v, fg, dg, tot in items:
        if low:
            if tot <= 3:
                out.append(f"{k}@{v}")
        else:
            if fg > dg and tot >= min_total:
                out.append(f"{k}@{v}")
        if len(out) >= n:
            break
    return out


def new_strategy(m, pts, gd, regime):
    """返回 dict: 原型, 信心(★/中/⚠/✗), 方向, 比分, 说明, parlay_leg"""
    spf = m.get("spf"); rq = m.get("rqspf"); hc = m.get("handicap")
    bf = load_odds(m["mid"]).get("bf_latest")
    e = exp_goals(load_odds(m["mid"]).get("zjq_latest"))
    lvl, fav_side, fo = strength(spf, rq, hc)
    gc = goalcat(e)
    arch = f"{lvl}+{gc}" if lvl else "?"
    home, away = m["home"], m["away"]
    ph, pa = pts.get(home, 0), pts.get(away, 0)
    fav_team = home if fav_side == "home" else away
    dog_team = away if fav_side == "home" else home
    fav_pts = ph if fav_side == "home" else pa
    dog_pts = pa if fav_side == "home" else ph
    fav_lbl = "让胜" if fav_side == "home" else "让负"
    rq_fav = (rq or {}).get(fav_side)

    conf, direction, scores, note, leg = "✗", "—", [], "", None
    both_desp = (ph <= 1 and pa <= 1) and m.get("round") == 2

    if lvl in ("超强", "强打弱") and gc == "大球型":
        conf = "★高"; direction = f"押{fav_team}({fav_lbl} @{rq_fav})"
        scores = cheap_scores(bf, fav_side, 4, 2)
        note = "最好读原型;放开取多球比分,去掉和棋"
        leg = {"text": f"{m['match']} {fav_lbl}@{rq_fav}", "odds": rq_fav, "conf": "★"}
    elif lvl in ("超强", "强打弱") and gc == "中球":
        conf = "⚠陷阱"; direction = f"慎押{fav_team};价值或在{dog_team}+/平"
        scores = cheap_scores(bf, fav_side, 3, 2)
        note = "强打弱+闷局=反直觉冷门温床(史29%冷),别当铁腿"
    elif lvl in ("超强", "强打弱") and gc == "防守型":
        conf = "中"; direction = f"押{fav_team}小胜"
        scores = cheap_scores(bf, fav_side, 3, 1)
        note = "强弱悬殊但闷,取小胜比分"
    elif lvl == "中等" and both_desp:
        conf = "✗跳过"; direction = "—"
        note = "中等强度+双方0/1分搏命,信号不干净→看不懂不下场"
    elif lvl == "中等" and gc == "中球":
        conf = "中"; direction = "偏平/热门不败"
        scores = cheap_scores(bf, fav_side, 3, 1)
        note = "中等+中球=偏平(本届和棋活),热门非铁,留平"
    elif lvl == "中等" and gc == "大球型":
        conf = "中"; direction = f"押{fav_team}不败+大球"
        scores = cheap_scores(bf, fav_side, 3, 2)
        note = "中等+大球,热门有利但非锁"
    elif lvl == "均势":
        conf = "✗跳过"; note = "均势局市场都分不出强弱→看不懂不下场"
    else:
        conf = "中"; note = f"原型{arch},按形态谨慎"

    # 心态叠加: 大众侧(名门/热门)已养生(≥4分) → R3才典型, R2标注
    if fav_pts >= 4 and dog_pts <= 1 and m.get("round", 0) >= 3:
        note += " | 养生局风险:热门或轮换,留意冷门"
    return {"arch": arch, "E": e, "conf": conf, "direction": direction,
            "scores": scores, "note": note, "leg": leg,
            "fav_pts": fav_pts, "dog_pts": dog_pts}


# ---------- 渲染 ----------
def render(date, matches, pts, gd, regime, rnd, picker=None):
    L = []
    L.append(f"# {date} 出单合并报告 (31规则 + 新策略)\n")
    # 本届指纹
    fav_gap = regime["fav_hit"] - regime["fav_imp"]
    lean = "信热门(热门兑现>隐含)" if fav_gap > 0.02 else ("热门偏贵慎追" if fav_gap < -0.02 else "热门中性")
    L.append(f"**本届指纹(2026, n={regime['n']}):** 场均球 {regime['gpg']:.2f} "
             f"{'(高球→比分/总进球上移)' if regime['gpg']>2.7 else ''} | "
             f"热门兑现 {regime['fav_hit']:.0%} vs 隐含 {regime['fav_imp']:.0%} → **{lean}** | "
             f"平局 {regime['draw']:.0%} {'(和棋活,别轻易排平/0:0)' if regime['draw']>0.28 else ''}\n")
    chalk = fav_gap > 0.02

    # ===== 31 规则段 =====
    cat1 = (picker or {}).get("cat1", {})
    slimN = cat1.get("slimCount", 0); dualN = cat1.get("dualCount", 0)
    L.append("\n## 一、31规则 出单\n")
    L.append(f"> **SLIM/DUAL 分流:** 单选 {slimN} 场 / 双选 {dualN} 场 (5 OR 规则 + G 规则 2026-06-20 新增: hc=+1 强制 DUAL)\n")
    L.append("| 场次 | 类型 | 让球 | SLIM/DUAL | F4主池比分 | rqspf 主+次选 |")
    L.append("|---|---|---|---|---|---|")
    for m in matches:
        picks = " / ".join(f"{p['score']}@{p['odds']}" for p in m.get("mainPicks", [])) or "—"
        rqf = m.get("_rq_primary"); rqs = m.get("_rq_secondary")
        # SLIM/DUAL 判定 (用 is_rq_slim 复刻 strategy_core 逻辑)
        is_slim = is_rq_slim(m, rqf) if rqf else False
        if rqf and rqs and not is_slim:
            rq_cell = f"**{rqf['label']}@{rqf['odds']}** + {rqs['label']}@{rqs['odds']} (双选)"
        elif rqf and is_slim:
            rq_cell = f"{rqf['label']}@{rqf['odds']} (单选, 跳过次选)"
        elif rqf:
            rq_cell = f"{rqf['label']}@{rqf['odds']}"
        else:
            rq_cell = "—"
        slim_flag = "SLIM" if is_slim else "DUAL"
        if not is_slim and m.get("handicap") == 1:
            slim_flag = "**DUAL (G)**"
        L.append(f"| {m['code']} {m['match']} | {m.get('type','')} | {m.get('handicap')} | {slim_flag} | {picks} | {rq_cell} |")

    # ===== 31 规则串关套餐 (从 picker.cat1 读 parlay2/parlay4) =====
    parlay2_list = cat1.get("parlay2") or []
    parlay4_raw = cat1.get("parlay4")
    parlay4_list = parlay4_raw if isinstance(parlay4_raw, list) else ([parlay4_raw] if parlay4_raw else [])
    parlay3_list = cat1.get("parlay3") or []
    n2 = len(parlay2_list)
    n4 = len(parlay4_list)
    n3 = len(parlay3_list)
    total = n2 + n3 + n4
    if total > 0:
        L.append(f"\n### 31规则 串关套餐 (2×1 {n2} + 3×1 {n3} + 4×1 {n4} = {total} 注)\n")
        if n2:
            L.append(f"\n**2串1 (单选 {slimN} 选 2 = C({slimN},2) = {n2} 注):**\n")
            L.append("| # | 线路 | 串关赔率 | 注金 |")
            L.append("|---|------|----------|------|")
            for i, t in enumerate(parlay2_list, 1):
                legs_str = " × ".join(f"{l['code']} {l['label']}@{l['odds']}" for l in t["legs"])
                L.append(f"| {i} | {legs_str} | {t['odds']} | {t['stake']} |")
        if n3:
            L.append(f"\n**3串1 (= {n3} 注):**\n")
            L.append("| # | 线路 | 串关赔率 | 注金 |")
            L.append("|---|------|----------|------|")
            for i, t in enumerate(parlay3_list, 1):
                legs_str = " × ".join(f"{l['code']} {l['label']}@{l['odds']}" for l in t["legs"])
                L.append(f"| {i} | {legs_str} | {t['odds']} | {t['stake']} |")
        if n4:
            L.append(f"\n**4串1 (单选+双选展开 = {n4} 注, 原子模型):**\n")
            L.append("| # | 线路 | 串关赔率 | 注金 |")
            L.append("|---|------|----------|------|")
            for i, t in enumerate(parlay4_list, 1):
                legs_str = " × ".join(f"{l['code']} {l['label']}@{l['odds']}" for l in t["legs"])
                L.append(f"| {i} | {legs_str} | {t['odds']} | {t['stake']} |")
        if n4 == 0:
            L.append(f"\n> **4×1 已跳过** — parlay4OnlyN4=true, 仅 n=4 (4 单选) 才出 4x1; "
                     f"今日 n={slimN} (n=3 降级后或本身就 n=2) 不满足。")

    # ===== 新策略段 =====
    L.append("\n## 二、新策略 出单(另起一段)\n")
    L.append("| 场次 | 原型 | E[球] | R1后(主/客) | 信心 | 方向 | 推荐比分 | 说明 |")
    L.append("|---|---|---|---|---|---|---|---|")
    legs = []
    for m in matches:
        s = m["_new"]
        ph = pts.get(m["home"], 0); pa = pts.get(m["away"], 0)
        sc = " ".join(s["scores"]) if s["scores"] else "—"
        eg = f"{s['E']:.2f}" if s["E"] is not None else "?"
        L.append(f"| {m['code']} {m['match']} | {s['arch']} | {eg} | {ph}/{pa} | "
                 f"{s['conf']} | {s['direction']} | {sc} | {s['note']} |")
        if s["leg"]:
            legs.append(s["leg"])

    # 串关建议
    L.append("\n**串关建议:**")
    star = [l for l in legs if l["conf"] == "★"]
    if not chalk:
        L.append("- 本届热门未在兑现(或转冷)→ 串关慎用,或改用覆盖胆对冲;优先单注。")
    if len(star) >= 2:
        prod = 1.0
        for l in star:
            prod *= (l["odds"] or 1)
        L.append(f"- 本届信热门→ clean 串 {len(star)} 条★正EV腿: "
                 + " × ".join(l["text"] for l in star)
                 + f" ≈ **{prod:.2f}倍**")
    elif len(star) == 1:
        L.append(f"- 仅 1 条★铁腿({star[0]['text']})→ **低机会日,建议单注**,凑数串关需小仓。")
    else:
        L.append("- 无★高信心腿→ 今日不建议串关,空仓或极小仓试探。")

    L.append("\n## 诚实刹车")
    L.append("- 新策略规律来自 2022全程+2026在赛(小样本,原型最准格 n≈16-21);")
    L.append("- '信热门'是进行中读数,会随 R2/R3 变脸;R2 养生局尚不典型(多数队仍需分);")
    L.append("- 比分仅辅助收口,bf 高水位,主力价值在方向(spf/rqspf)与总进球(zjq);")
    L.append("- **G 规则(2026-06-20 新增)**: 主受让+1 强制 DUAL, 不再单边, 详见 strategy_core.isRqSlim。")
    return "\n".join(L)


def main():
    date = sys.argv[1] if len(sys.argv) > 1 else "2026-06-20"
    pf = latest_predict()
    if not pf:
        print("找不到 predict_31 文件"); return
    d = json.load(open(pf))
    rnd, grp = round_map()
    pts, gd, regime = standings_and_regime()

    # 取该日比赛
    matches = [m for m in d.get("matches", []) if str(m.get("kickoff", "")).startswith(date)]
    matches.sort(key=lambda x: x.get("kickoff", ""))
    # 附 rqspf 主腿 + 轮次 + 新策略
    rqmap = {x["code"]: x for x in d.get("rqspf_follow", [])}
    for m in matches:
        rq = rqmap.get(m["code"]) or {}
        m["_rq_primary"] = rq.get("primary")
        m["_rq_secondary"] = rq.get("secondary")
        m["round"] = rnd.get(str(m["mid"]))
        m["_new"] = new_strategy(m, pts, gd, regime)

    picker = d.get("picker", {})
    report = render(date, matches, pts, gd, regime, rnd, picker)
    out = os.path.join(MODEL, f"出单合并_{date}.md")
    open(out, "w").write(report)
    print(report)
    print(f"\n[已写入 {out}]")


if __name__ == "__main__":
    main()
