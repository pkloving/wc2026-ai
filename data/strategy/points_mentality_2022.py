#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
积分心态错价 (2022 世界杯, 按轮次重建积分)。

假设: 冷门/错价红利不在第1轮(已验证: R1 押冷亏), 而在第2、3轮 ——
  因为出线形势改变球队【动机】, 而动机是赔率不易完全定价的:
    · 养生局: 一方已基本出线(≥4分)轮换保留 → 仍需分的一方(常是冷门)被低估?
    · 死亡默契: 双方各拿1分即出线 → 平局被低估?
    · 双方搏命: 都必须赢 → 大球/不平?
做法:
  从 id_map 比分按 group 重建 R1/R2 后积分, 给每场 R2/R3 标注【赛前形势】,
  再分桶看 押冷门 / 押平 的 ROI 与校准。
  单届数据, 每格样本很小, 仅作探索, 结论需多届。
"""
import json
import os
from collections import defaultdict

BASE = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "2022wc")
OUT = {"home": "H", "draw": "D", "away": "A"}


def rnd(label):
    return (int(label.rsplit("-", 1)[1][1:]) - 1) // 2 + 1


def load():
    idmap = json.load(open(os.path.join(BASE, "id_map.json")))["matches"]
    ms = []
    for mid, m in idmap.items():
        if m.get("stage") != "group" or not m.get("full_time_score"):
            continue
        op = os.path.join(BASE, "odds", f"{mid}.json")
        if not os.path.exists(op):
            continue
        spf = json.load(open(op))["odds"].get("spf_latest")
        if not spf:
            continue
        hg, ag = (int(x) for x in m["full_time_score"].split(":"))
        res = "H" if hg > ag else ("A" if ag > hg else "D")
        trip = sorted([("H", spf["home"]), ("D", spf["draw"]), ("A", spf["away"])],
                      key=lambda x: x[1])
        ms.append({"grp": m["group"], "rnd": rnd(m["label"]),
                   "home": m["home"], "away": m["away"], "hg": hg, "ag": ag,
                   "res": res, "spf": spf, "fav": trip[0], "dog": trip[2],
                   "label": m["label"]})
    return ms


def standings_before(ms, grp, before_rnd):
    """返回该组在 before_rnd 之前各队积分/净胜球 (只累计 rnd<before_rnd)。"""
    pts = defaultdict(int)
    gd = defaultdict(int)
    for m in ms:
        if m["grp"] != grp or m["rnd"] >= before_rnd:
            continue
        if m["res"] == "H":
            pts[m["home"]] += 3
        elif m["res"] == "A":
            pts[m["away"]] += 3
        else:
            pts[m["home"]] += 1
            pts[m["away"]] += 1
        gd[m["home"]] += m["hg"] - m["ag"]
        gd[m["away"]] += m["ag"] - m["hg"]
    return pts, gd


def scenario(ph, pa, rd):
    """赛前形势标签 (ph/pa = 主/客赛前积分)。"""
    hi, lo = max(ph, pa), min(ph, pa)
    if rd == 3:
        if hi >= 4 and lo <= 1:
            return "养生局(一方已稳/一方近淘汰)"
        if hi >= 4 and lo <= 3:
            return "强弱动机差(一方已稳)"
        if ph == pa and ph in (1, 2, 3, 4):
            return "双方同分搏出线"
        return "其他R3"
    # R2 (赛前各队仅1场, 积分 0/1/3)
    if hi == 3 and lo == 0:
        return "一胜一负相遇"
    if ph == 0 and pa == 0:
        return "双方首轮皆负(背水)"
    return "其他R2"


def roi(items, side):  # side: 'dog' or draw key 'D'
    cost = ret = hits = 0
    for m in items:
        if side == "dog":
            k, o = m["dog"]
        else:
            k, o = "D", m["spf"]["draw"]
        cost += 1
        if k == m["res"]:
            ret += o
            hits += 1
    return cost, hits, (ret - cost) / cost * 100 if cost else 0


def report(title, items, side, side_name):
    c, h, r = roi(items, side)
    if side == "dog":
        imp = sum(1 / m["dog"][1] for m in items) / c if c else 0
        act = sum(1 for m in items if m["res"] == m["dog"][0]) / c if c else 0
    else:
        imp = sum(1 / m["spf"]["draw"] for m in items) / c if c else 0
        act = sum(1 for m in items if m["res"] == "D") / c if c else 0
    flag = "低估=有肉" if act > imp else "高估=陷阱"
    print(f"  {title:<26}{c:>3}场  {side_name}{h}/{c} "
          f"ROI{r:>7.1f}%  (隐含{imp:.0%} vs 实际{act:.0%} {flag})")


def main():
    ms = load()
    # 给每场补 赛前积分 + 形势
    for m in ms:
        if m["rnd"] == 1:
            m["scn"] = "第1轮(对照)"
            continue
        pts, _ = standings_before(ms, m["grp"], m["rnd"])
        m["scn"] = scenario(pts[m["home"]], pts[m["away"]], m["rnd"])

    print("=" * 78)
    print("积分心态错价扫描 — 2022 世界杯小组赛 (按赛前形势分桶)")
    print("=" * 78)

    print("\n[基准] 各轮 押冷门 / 押平 ROI:\n")
    for rd in (1, 2, 3):
        sub = [m for m in ms if m["rnd"] == rd]
        report(f"第{rd}轮 全部", sub, "dog", "冷")
        report(f"第{rd}轮 全部", sub, "D", "平")
        print()

    print("[场景] 第2、3轮按赛前形势分桶 (押冷门):\n")
    scn_order = ["养生局(一方已稳/一方近淘汰)", "强弱动机差(一方已稳)",
                 "双方同分搏出线", "其他R3", "一胜一负相遇",
                 "双方首轮皆负(背水)", "其他R2"]
    seen = defaultdict(list)
    for m in ms:
        if m["rnd"] >= 2:
            seen[m["scn"]].append(m)
    for scn in scn_order:
        if seen[scn]:
            report(scn, seen[scn], "dog", "冷")

    print("\n[场景] 同分搏出线 / 双方皆负 等 看押平:\n")
    for scn in ["双方同分搏出线", "养生局(一方已稳/一方近淘汰)", "其他R3"]:
        if seen[scn]:
            report(scn, seen[scn], "D", "平")

    print("\n" + "=" * 78)
    print("判读: 找 '实际>隐含(低估=有肉)' 且 ROI 正 的场景 → 动机错价入口。")
    print("      每格样本极小(R3 仅 16 场再细分), 只是探路; 真要用需多届累积验证。")


if __name__ == "__main__":
    main()
