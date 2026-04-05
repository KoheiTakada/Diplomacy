# -*- coding: utf-8 -*-
"""
Illustrator 出力 SVG に classic マップ用の属性とオーバーレイを付与する。

概要:
  data-name（日本語）を classicProvinces.json の州に対応づけ、
  id / data-province / data-area-type を設定する。
  各州のヒット形状から重心を求め unit-anchors-army / unit-anchors-fleet と
  supply-centers を追加する。艦隊は STP/SPA/BUL のみ岸ごとに data-fleet-coast 付きの
  複数ドット（初期は重心＋オフセット）。その他は陸軍と同座標の1ドット。
  手調整はマスタ SVG で行い sync-map。

制限:
  描画用レイヤー内の黒（st4）1 ポリゴンのみスイス（SWI）としてタグ付けする（ボード 75 州には含めない）。
  data-name と JSON の ja が一致しない場合は JA_ALIAS で補う。
"""

from __future__ import annotations

import io
import json
import re
import math
import xml.etree.ElementTree as ET

SVG_NS = "http://www.w3.org/2000/svg"


def q(tag: str) -> str:
    return f"{{{SVG_NS}}}{tag}"


JA_ALIAS = {
    "チュニス": "チュニジア",
    "アドリア湾": "アドリア海",
    "ボスニア湾": "ボトニア湾",
    "サンクトペテルブルグ": "サンクトペテルブルク",
    "ピエモント": "ピエモンテ",
    "リヨン海": "リヨン湾",
    "ヘルゴランド湾": "ヘルゴラント湾",
}

SKIP_GROUP_NAMES = frozenset(
    {"描画用:非プロヴィンス", "内陸", "沿岸", "海", "海岸線", "レイヤー_1"}
)

# classicProvinces に含めないが描画上有る形状（_tag_swiss_impassable で SWI を付与）
SKIP_DATA_NAMES = frozenset({"スイス"})

# 分割岸プロヴィンスの艦隊アンカー（SVG では data-anchor + data-fleet-coast）
SPLIT_PROVINCE_FLEET_COASTS: dict[str, tuple[str, ...]] = {
    "STP": ("NC", "SC"),
    "SPA": ("NC", "SC"),
    "BUL": ("EC", "SC"),
}

# 重心からのラフオフセット（岸ごとに分けて編集しやすい程度。手調整で上書き可）
FLEET_COAST_OFFSET: dict[tuple[str, str], tuple[float, float]] = {
    ("STP", "NC"): (-16.0, -12.0),
    ("STP", "SC"): (16.0, 10.0),
    ("SPA", "NC"): (-14.0, 8.0),
    ("SPA", "SC"): (12.0, -10.0),
    ("BUL", "EC"): (14.0, -4.0),
    ("BUL", "SC"): (-12.0, 10.0),
}


def parse_points(s: str) -> list[tuple[float, float]]:
    nums = [float(x) for x in re.split(r"[\s,]+", s.strip()) if x]
    return [(nums[i], nums[i + 1]) for i in range(0, len(nums), 2)]


def centroid_poly(pts: list[tuple[float, float]]) -> tuple[float, float]:
    if len(pts) < 3:
        return (
            sum(p[0] for p in pts) / len(pts),
            sum(p[1] for p in pts) / len(pts),
        )
    a = 0.0
    cx = cy = 0.0
    n = len(pts)
    for i in range(n):
        x0, y0 = pts[i]
        x1, y1 = pts[(i + 1) % n]
        cross = x0 * y1 - x1 * y0
        a += cross
        cx += (x0 + x1) * cross
        cy += (y0 + y1) * cross
    a *= 0.5
    if abs(a) < 1e-9:
        return (
            sum(p[0] for p in pts) / len(pts),
            sum(p[1] for p in pts) / len(pts),
        )
    cx /= 6 * a
    cy /= 6 * a
    return (cx, cy)


def path_centroid_avg(d: str) -> tuple[float, float]:
    pts: list[tuple[float, float]] = []
    x = y = 0.0
    for cmd, rest in re.findall(r"([MmLlHhVvZz])([^MmLlHhVvZz]*)", d):
        rest = rest.strip().rstrip(",")
        if cmd in "Zz":
            continue
        nums = [float(n) for n in re.findall(r"[-+]?\d*\.?\d+", rest)]
        if cmd == "M":
            x, y = nums[0], nums[1]
            pts.append((x, y))
            i = 2
            while i < len(nums):
                x, y = nums[i], nums[i + 1]
                pts.append((x, y))
                i += 2
        elif cmd == "m":
            x += nums[0]
            y += nums[1]
            pts.append((x, y))
            i = 2
            while i < len(nums):
                x += nums[i]
                y += nums[i + 1]
                pts.append((x, y))
                i += 2
        elif cmd == "L":
            i = 0
            while i < len(nums):
                x, y = nums[i], nums[i + 1]
                pts.append((x, y))
                i += 2
        elif cmd == "l":
            i = 0
            while i < len(nums):
                x += nums[i]
                y += nums[i + 1]
                pts.append((x, y))
                i += 2
        elif cmd == "H":
            for v in nums:
                x = v
                pts.append((x, y))
        elif cmd == "h":
            for v in nums:
                x += v
                pts.append((x, y))
        elif cmd == "V":
            for v in nums:
                y = v
                pts.append((x, y))
        elif cmd == "v":
            for v in nums:
                y += v
                pts.append((x, y))
    if not pts:
        return (0.0, 0.0)
    return (
        sum(p[0] for p in pts) / len(pts),
        sum(p[1] for p in pts) / len(pts),
    )


def _mat_mul(a: list[list[float]], b: list[list[float]]) -> list[list[float]]:
    return [
        [
            sum(a[i][k] * b[k][j] for k in range(3))
            for j in range(3)
        ]
        for i in range(3)
    ]


def _mat_vec(m: list[list[float]], x: float, y: float) -> tuple[float, float]:
    xh = m[0][0] * x + m[0][1] * y + m[0][2]
    yh = m[1][0] * x + m[1][1] * y + m[1][2]
    return (xh, yh)


def _parse_transform(tf: str) -> list[list[float]]:
    """
    SVG の transform 属性を 3x3 行列にまとめる。

    仕様上、リストは「右側の指定から」ローカル座標に適用される。
    属性が translate(A) rotate(B) のとき、点 p には
    translate(A) * rotate(B) * p が相当する（B を先にかける）。
    """
    m = [[1.0, 0.0, 0.0], [0.0, 1.0, 0.0], [0.0, 0.0, 1.0]]
    if not tf:
        return m
    chunks = re.findall(
        r"(translate|rotate|scale|matrix)\(([^)]+)\)", tf
    )
    for name, args in reversed(chunks):
        nums = [float(v) for v in re.findall(r"[-+]?\d*\.?\d+", args)]
        if name == "translate":
            tx = nums[0]
            ty = nums[1] if len(nums) > 1 else 0.0
            t = [[1.0, 0.0, tx], [0.0, 1.0, ty], [0.0, 0.0, 1.0]]
            m = _mat_mul(t, m)
        elif name == "rotate":
            ang = math.radians(nums[0])
            c = math.cos(ang)
            s = math.sin(ang)
            if len(nums) >= 3:
                cx, cy = nums[1], nums[2]
                t1 = [[1.0, 0.0, cx], [0.0, 1.0, cy], [0.0, 0.0, 1.0]]
                r = [[c, -s, 0.0], [s, c, 0.0], [0.0, 0.0, 1.0]]
                t2 = [[1.0, 0.0, -cx], [0.0, 1.0, -cy], [0.0, 0.0, 1.0]]
                r_around = _mat_mul(t1, _mat_mul(r, t2))
                m = _mat_mul(r_around, m)
            else:
                r = [[c, -s, 0.0], [s, c, 0.0], [0.0, 0.0, 1.0]]
                m = _mat_mul(r, m)
        elif name == "scale":
            sx = nums[0]
            sy = nums[1] if len(nums) > 1 else sx
            t = [[sx, 0.0, 0.0], [0.0, sy, 0.0], [0.0, 0.0, 1.0]]
            m = _mat_mul(t, m)
        elif name == "matrix" and len(nums) >= 6:
            a, b, c, d, e, f = nums[:6]
            t = [[a, c, e], [b, d, f], [0.0, 0.0, 1.0]]
            m = _mat_mul(t, m)
    return m


def rect_center(el: ET.Element) -> tuple[float, float]:
    x = float(el.get("x", 0))
    y = float(el.get("y", 0))
    w = float(el.get("width", 0))
    h = float(el.get("height", 0))
    cx = x + w / 2
    cy = y + h / 2
    mat = _parse_transform(el.get("transform") or "")
    return _mat_vec(mat, cx, cy)


def _tag_swiss_impassable(root: ET.Element, anchors: dict[str, tuple[float, float]]) -> None:
    """
    描画用レイヤー内の黒塗り（class st4）ポリゴンを通過不可のスイス（SWI）としてタグ付けする。

    パラメータ:
        root: SVG ルート要素
        anchors: 州 ID → 重心。SWI を追加する

    制限:
        st4 ポリゴンが複数ある場合は先頭のみを SWI とみなす。
    """
    for el in root.iter():
        if not isinstance(el.tag, str):
            continue
        if el.tag.split("}")[-1] != "g":
            continue
        if el.get("data-name") != "描画用:非プロヴィンス":
            continue
        for child in el:
            if not isinstance(child.tag, str):
                continue
            if child.tag.split("}")[-1] != "polygon":
                continue
            classes = child.get("class") or ""
            if "st4" not in classes:
                continue
            child.set("id", "SWI")
            child.set("data-province", "SWI")
            child.set("data-area-type", "Land")
            child.set("data-name", "スイス")
            child.set("data-impassable", "true")
            prev = (child.get("class") or "").strip()
            child.set("class", (prev + " swiss-impassable").strip())
            anchors["SWI"] = shape_center(child)
            return
    raise SystemExit("スイス用の st4 ポリゴンが 描画用:非プロヴィンス 内に見つかりません")


def shape_center(el: ET.Element) -> tuple[float, float]:
    tag = el.tag.split("}")[-1]
    if tag == "polygon":
        pts = parse_points(el.get("points", ""))
        return centroid_poly(pts) if pts else (0.0, 0.0)
    if tag == "path":
        return path_centroid_avg(el.get("d", ""))
    if tag == "rect":
        return rect_center(el)
    return (0.0, 0.0)


def enrich_svg(svg_in: str, provinces_path: str, svg_out: str) -> None:
    with open(provinces_path, encoding="utf-8") as f:
        provinces = json.load(f)
    by_ja = {p["ja"]: p for p in provinces}

    def resolve(ja_name: str):
        key = JA_ALIAS.get(ja_name, ja_name)
        return by_ja.get(key)

    ET.register_namespace("", SVG_NS)
    tree = ET.parse(svg_in)
    root = tree.getroot()

    style_el = root.find(f"{q('defs')}/{q('style')}")
    extra_css = """
      .map-overlay {
        pointer-events: none;
      }
      .supply-marker {
        fill: none;
        stroke: #231815;
        stroke-width: 1.1;
      }
      .supply-marker-home {
        stroke-width: 1.6;
      }
      .swiss-impassable {
        cursor: not-allowed;
      }
"""
    if style_el is not None:
        t = style_el.text or ""
        if ".map-overlay" not in t:
            t += extra_css
        elif ".swiss-impassable" not in t:
            t += """
      .swiss-impassable {
        cursor: not-allowed;
      }
"""
        style_el.text = t

    anchors: dict[str, tuple[float, float]] = {}
    unmapped: list[str] = []

    for el in root.iter():
        if not isinstance(el.tag, str):
            continue
        tag = el.tag.split("}")[-1]
        if tag not in ("polygon", "path", "rect"):
            continue
        dname = el.get("data-name")
        if not dname or dname in SKIP_GROUP_NAMES or dname in SKIP_DATA_NAMES:
            continue
        prov = resolve(dname)
        if prov is None:
            unmapped.append(dname)
            continue
        pid = prov["id"]
        el.set("id", pid)
        el.set("data-province", pid)
        el.set("data-area-type", prov["areaType"])
        anchors[pid] = shape_center(el)

    if unmapped:
        raise SystemExit("未対応の data-name: " + ", ".join(sorted(set(unmapped))))

    _tag_swiss_impassable(root, anchors)

    to_drop: list[ET.Element] = []
    for el in root:
        if isinstance(el.tag, str) and el.tag.endswith("g"):
            gid = el.get("id")
            if gid in (
                "unit-anchors",
                "unit-anchors-army",
                "unit-anchors-fleet",
                "supply-centers",
            ):
                to_drop.append(el)
    for el in to_drop:
        root.remove(el)

    supply_ids = [p["id"] for p in provinces if p["isSupplyCenter"]]
    home_ids = {p["id"] for p in provinces if p.get("homePowerId")}

    def make_unit_anchor_group(gid: str) -> ET.Element:
        g = ET.Element(q("g"))
        g.set("id", gid)
        g.set("class", "map-overlay")
        g.set("display", "none")
        g.set("aria-hidden", "true")
        for pid in sorted(anchors.keys()):
            cx, cy = anchors[pid]
            c = ET.SubElement(g, q("circle"))
            c.set("data-anchor", pid)
            c.set("cx", f"{cx:.2f}")
            c.set("cy", f"{cy:.2f}")
            c.set("r", "1")
        return g

    ua_army = make_unit_anchor_group("unit-anchors-army")

    def make_fleet_anchor_group() -> ET.Element:
        g = ET.Element(q("g"))
        g.set("id", "unit-anchors-fleet")
        g.set("class", "map-overlay")
        g.set("display", "none")
        g.set("aria-hidden", "true")
        for pid in sorted(anchors.keys()):
            cx, cy = anchors[pid]
            coasts = SPLIT_PROVINCE_FLEET_COASTS.get(pid)
            if coasts:
                for coast in coasts:
                    dx, dy = FLEET_COAST_OFFSET.get((pid, coast), (0.0, 0.0))
                    c = ET.SubElement(g, q("circle"))
                    c.set("data-anchor", pid)
                    c.set("data-fleet-coast", coast)
                    c.set("cx", f"{cx + dx:.2f}")
                    c.set("cy", f"{cy + dy:.2f}")
                    c.set("r", "1")
            else:
                c = ET.SubElement(g, q("circle"))
                c.set("data-anchor", pid)
                c.set("cx", f"{cx:.2f}")
                c.set("cy", f"{cy:.2f}")
                c.set("r", "1")
        return g

    ua_fleet = make_fleet_anchor_group()

    sc = ET.Element(q("g"))
    sc.set("id", "supply-centers")
    sc.set("class", "map-overlay")
    sc.set("aria-hidden", "true")
    for pid in supply_ids:
        if pid not in anchors:
            raise SystemExit(f"supply の重心なし: {pid}")
        cx, cy = anchors[pid]
        c = ET.SubElement(sc, q("circle"))
        c.set("data-supply", pid)
        c.set("cx", f"{cx:.2f}")
        c.set("cy", f"{cy:.2f}")
        c.set("r", "4")
        cls = "supply-marker"
        if pid in home_ids:
            cls += " supply-marker-home"
        c.set("class", cls)

    root.append(sc)
    root.append(ua_army)
    root.append(ua_fleet)

    buf = io.BytesIO()
    tree.write(buf, encoding="utf-8", xml_declaration=True, default_namespace="")
    text = buf.getvalue().decode("utf-8")
    with open(svg_out, "w", encoding="utf-8") as f:
        f.write(text)


if __name__ == "__main__":
    import os

    base = os.path.join(os.path.dirname(__file__), "..", "..")
    enrich_svg(
        os.path.join(base, "web", "public", "illustrator-map.svg"),
        os.path.join(base, "web", "src", "classicProvinces.json"),
        os.path.join(base, "web", "public", "illustrator-map.svg"),
    )
    enrich_svg(
        os.path.join(base, "ディプロマシー地図.svg"),
        os.path.join(base, "web", "src", "classicProvinces.json"),
        os.path.join(base, "ディプロマシー地図.svg"),
    )
    print("OK: illustrator-map.svg と ディプロマシー地図.svg を更新しました")
    print("ヒント: ルートの ディプロマシー地図.svg でアンカーを手調整したら web で npm run sync-map")
