# -*- coding: utf-8 -*-
"""
手調整した ディプロマシー地図.svg のアンカー・補給マーカーを
web/public/illustrator-map.svg に反映する。

概要:
  - supply-centers
  - unit-anchors-army / unit-anchors-fleet（陸軍・海軍それぞれの配置用ドット）
  - 艦隊は STP/SPA/BUL 等で circle に data-fleet-coast（NC/SC/EC）を付け、
    同一州に複数ドットを置ける（同期時は data-anchor|岸 で内部キー化）。
  後方互換: マスタに unit-anchors のみある場合は陸海両方に同一座標を複製する。

制限:
  マスタに存在する data-anchor / data-supply のみ更新する。
  マスタ svg ルートの viewBox を illustrator-map.svg にも写す（余白調整を反映）。
"""

from __future__ import annotations

import json
import os
import xml.etree.ElementTree as ET

SVG_NS = "http://www.w3.org/2000/svg"


def q(tag: str) -> str:
    return f"{{{SVG_NS}}}{tag}"


def load_home_supply_ids(json_path: str) -> set[str]:
    with open(json_path, encoding="utf-8") as f:
        provinces = json.load(f)
    return {
        p["id"]
        for p in provinces
        if p.get("isSupplyCenter") and p.get("homePowerId")
    }


def parse_circles_by_attr(
    root: ET.Element, group_id: str, data_attr: str
) -> dict[str, tuple[float, float]]:
    out: dict[str, tuple[float, float]] = {}
    for g in root.iter():
        if not isinstance(g.tag, str) or not g.tag.endswith("g"):
            continue
        if g.get("id") != group_id:
            continue
        for c in g:
            if not isinstance(c.tag, str) or not c.tag.endswith("circle"):
                continue
            pid = c.get(data_attr)
            cx_s = c.get("cx")
            cy_s = c.get("cy")
            if not pid or cx_s is None or cy_s is None:
                continue
            out[pid] = (float(cx_s), float(cy_s))
        break
    return out


def parse_fleet_anchor_positions(root: ET.Element) -> dict[str, tuple[float, float]]:
    """
    unit-anchors-fleet を読み取る。

    Returns:
        キーは州ID、または「州ID|岸コード」（data-fleet-coast がある場合）。
    """
    out: dict[str, tuple[float, float]] = {}
    for g in root.iter():
        if not isinstance(g.tag, str) or not g.tag.endswith("g"):
            continue
        if g.get("id") != "unit-anchors-fleet":
            continue
        for c in g:
            if not isinstance(c.tag, str) or not c.tag.endswith("circle"):
                continue
            pid = c.get("data-anchor")
            cx_s = c.get("cx")
            cy_s = c.get("cy")
            if not pid or cx_s is None or cy_s is None:
                continue
            coast = c.get("data-fleet-coast")
            key = f"{pid}|{coast}" if coast else pid
            out[key] = (float(cx_s), float(cy_s))
        break
    return out


def build_fleet_anchor_group(
    positions: dict[str, tuple[float, float]],
) -> ET.Element:
    """艦隊アンカー。複合キーは data-anchor + data-fleet-coast で出力する。"""
    g = ET.Element(q("g"))
    g.set("id", "unit-anchors-fleet")
    g.set("class", "map-overlay")
    g.set("display", "none")
    g.set("aria-hidden", "true")
    for key in sorted(positions.keys()):
        cx, cy = positions[key]
        c = ET.SubElement(g, q("circle"))
        if "|" in key:
            pid, coast = key.split("|", 1)
            c.set("data-anchor", pid)
            c.set("data-fleet-coast", coast)
        else:
            c.set("data-anchor", key)
        c.set("cx", f"{cx:.2f}")
        c.set("cy", f"{cy:.2f}")
        c.set("r", "1")
    return g


def build_supply_group(
    positions: dict[str, tuple[float, float]], home_ids: set[str]
) -> ET.Element:
    g = ET.Element(q("g"))
    g.set("id", "supply-centers")
    g.set("class", "map-overlay")
    g.set("aria-hidden", "true")
    for pid in sorted(positions.keys()):
        cx, cy = positions[pid]
        c = ET.SubElement(g, q("circle"))
        c.set("data-supply", pid)
        c.set("cx", f"{cx:.2f}")
        c.set("cy", f"{cy:.2f}")
        c.set("r", "4")
        cls = "supply-marker"
        if pid in home_ids:
            cls += " supply-marker-home"
        c.set("class", cls)
    return g


def build_unit_anchor_group(
    gid: str, positions: dict[str, tuple[float, float]]
) -> ET.Element:
    g = ET.Element(q("g"))
    g.set("id", gid)
    g.set("class", "map-overlay")
    g.set("display", "none")
    g.set("aria-hidden", "true")
    for pid in sorted(positions.keys()):
        cx, cy = positions[pid]
        c = ET.SubElement(g, q("circle"))
        c.set("data-anchor", pid)
        c.set("cx", f"{cx:.2f}")
        c.set("cy", f"{cy:.2f}")
        c.set("r", "1")
    return g


def replace_overlay_groups(
    svg_path: str,
    supply_g: ET.Element,
    army_g: ET.Element,
    fleet_g: ET.Element,
    viewbox: str | None,
) -> None:
    ET.register_namespace("", SVG_NS)
    tree = ET.parse(svg_path)
    root = tree.getroot()
    drop_ids = frozenset(
        {
            "supply-centers",
            "unit-anchors",
            "unit-anchors-army",
            "unit-anchors-fleet",
        }
    )
    to_remove: list[ET.Element] = []
    for child in list(root):
        if isinstance(child.tag, str) and child.tag.endswith("g"):
            gid = child.get("id")
            if gid in drop_ids:
                to_remove.append(child)
    for el in to_remove:
        root.remove(el)
    root.append(supply_g)
    root.append(army_g)
    root.append(fleet_g)
    if viewbox:
        root.set("viewBox", viewbox)
    tree.write(
        svg_path,
        encoding="utf-8",
        xml_declaration=True,
        default_namespace="",
    )


def main() -> None:
    base = os.path.join(os.path.dirname(__file__), "..", "..")
    hand = os.path.join(base, "ディプロマシー地図.svg")
    if not os.path.isfile(hand):
        raise SystemExit(f"マスタが見つかりません: {hand}")
    app_svg = os.path.join(base, "web", "public", "illustrator-map.svg")
    provinces_json = os.path.join(base, "web", "src", "classicProvinces.json")

    hand_root = ET.parse(hand).getroot()
    supply_pos = parse_circles_by_attr(hand_root, "supply-centers", "data-supply")
    army_pos = parse_circles_by_attr(hand_root, "unit-anchors-army", "data-anchor")
    fleet_pos = parse_fleet_anchor_positions(hand_root)
    legacy = parse_circles_by_attr(hand_root, "unit-anchors", "data-anchor")

    if not supply_pos:
        raise SystemExit("マスタに supply-centers の circle が見つかりません")

    if legacy and not army_pos and not fleet_pos:
        army_pos = dict(legacy)
        fleet_pos = dict(legacy)
    elif not army_pos or not fleet_pos:
        raise SystemExit(
            "マスタに unit-anchors-army と unit-anchors-fleet の両方が必要です"
            "（または従来の unit-anchors のみ）"
        )

    home_ids = load_home_supply_ids(provinces_json)
    supply_g = build_supply_group(supply_pos, home_ids)
    army_g = build_unit_anchor_group("unit-anchors-army", army_pos)
    fleet_g = build_fleet_anchor_group(fleet_pos)
    hand_vb = hand_root.get("viewBox")
    replace_overlay_groups(app_svg, supply_g, army_g, fleet_g, hand_vb)
    print(
        f"OK: supply {len(supply_pos)} / army {len(army_pos)} / fleet {len(fleet_pos)} → illustrator-map.svg"
    )


if __name__ == "__main__":
    main()
