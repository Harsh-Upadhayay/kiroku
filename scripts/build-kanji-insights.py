#!/usr/bin/env python3
"""Generate src/content/n5/kanji-insights.ts — kanji decomposition + mnemonic data.

Scope: every kanji taught in the N5 course (src/content/n5/raw/kanji) plus every
kanji that appears in N5 vocab words, plus any component of those kanji that has
its own RRTK entry (so the breakdown UI can drill down).

Data sources:
  - Component decomposition: KanjiVG (https://kanjivg.tagaini.net, CC BY-SA 3.0) —
    hierarchical, learner-style breakdown (麻 -> 广 + 林) that matches the mnemonics
    and tools like jpdb. KRADFILE (EDRDG) is a fallback for kanji KanjiVG lacks.
  - Keywords + mnemonic stories: RRTK_Recognition_Remembering_The_Kanji.apkg (repo root)
  - Readings (on/kun): KANJIDIC2 (EDRDG, http://www.edrdg.org/kanjidic/kanjidic2.xml.gz)
  - Radical meanings: curated table below (RTK-style learner names)
  - COMPONENT_OVERRIDES win over all of the above (hand-audited N5 breakdowns).

Usage:
  python3 scripts/build-kanji-insights.py          # N5 course .ts (default)
  python3 scripts/build-kanji-insights.py --full    # full-RTK JSON for lookup
Requires network only if /tmp/kradzip-cache/kradfile is absent.

The default build targets the N5 course (writes src/content/n5/kanji-insights.ts,
loaded synchronously by the course UI). The --full build targets every kanji that
has an RRTK story (~3,000) and writes public/data/kanji-insights-full.json, a
lazy-loaded superset consumed by the dictionary-lookup feature.
"""

import argparse
import gzip
import html
import json
import os
import re
import sqlite3
import subprocess
import sys
import tempfile
import urllib.request
import xml.etree.ElementTree as ET
import zipfile

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = os.path.join(REPO, "src", "content", "n5", "raw")
APKG = os.path.join(REPO, "RRTK_Recognition_Remembering_The_Kanji.apkg")
OUT = os.path.join(REPO, "src", "content", "n5", "kanji-insights.ts")
OUT_JSON = os.path.join(REPO, "public", "data", "kanji-insights-full.json")
KRAD_CACHE = "/tmp/kradzip-cache"
KRAD_URL = "http://ftp.edrdg.org/pub/Nihongo/kradzip.zip"
KANJIDIC_URL = "http://www.edrdg.org/kanjidic/kanjidic2.xml.gz"
KANJIVG_CACHE = "/tmp/kanjivg-cache"
KANJIVG_RELEASES_API = "https://api.github.com/repos/KanjiVG/kanjivg/releases/latest"
KANJIVG_NS = "{http://kanjivg.tagaini.net}"

# Decomposition source: KanjiVG (https://kanjivg.tagaini.net, CC BY-SA 3.0) provides
# a hierarchical, learner-style breakdown (麻 -> 广 + 林) that matches how mnemonics
# and tools like jpdb decompose kanji, unlike KRADFILE's flat radical list. KanjiVG
# spells some radicals with their standalone glyph; remap those to the same
# CJK-Radicals-Supplement glyphs the curated tables above use, so meanings resolve
# and the glyph style stays consistent with the N5 course.
KVG_NORMALIZE = {
    "亻": "⺅", "氵": "⺡", "艹": "⺾", "扌": "⺘", "忄": "⺖", "刂": "⺉",
    "辶": "⻌", "灬": "⺣", "礻": "⺭", "衤": "⻂", "罒": "⺲", "犭": "⺨",
    "阝": "⻖", "𤣩": "王", "纟": "糸", "钅": "金", "丿": "ノ",
}

def is_kanji(ch):
    return "一" <= ch <= "鿿"

# KRADFILE represents radicals that are not in JIS X 0208 with a stand-in kanji
# that merely *contains* the element (documented in kradintro). Remap stand-ins
# to the real radical glyph so we never show e.g. 化 "change" for the person radical.
PLACEHOLDER_RADICALS = {
    "化": ("⺅", "person (left)"),
    "个": ("𠆢", "person (roof)"),
    "并": ("丷", "horns"),
    "刈": ("⺉", "sword (right)"),
    "込": ("⻌", "road / movement"),
    "尚": ("⺌", "little (hat of dots)"),
    "忙": ("⺖", "heart / feelings (left)"),
    "扎": ("⺘", "hand (left)"),
    "汁": ("⺡", "water (drops)"),
    "犯": ("⺨", "wild dog / beast (left)"),
    "艾": ("⺾", "grass / flowers (top)"),
    "邦": ("⻏", "city / village (right)"),
    "阡": ("⻖", "hill / mound (left)"),
    "老": ("⺹", "old man (top)"),
    "杰": ("⺣", "fire sparks (bottom)"),
    "礼": ("⺭", "altar / spirit (left)"),
    "疔": ("疒", "sickness (cave)"),
    "禹": ("禸", "trampling track"),
    "初": ("⻂", "clothes (left)"),
    "買": ("⺲", "net / eye (top)"),
    "滴": ("啇", "old stem"),
    "乞": ("𠂉", "bent person / hairpin"),
}

# Learner-friendly names for radicals/elements that have no RRTK keyword.
RADICAL_MEANINGS = {
    "｜": "stick (vertical stroke)",
    "ノ": "drop (slanting stroke)",
    "丶": "dot",
    "ハ": "fins / eight",
    "マ": "claw hook",
    "ユ": "hook (yu shape)",
    "ヨ": "broom / pig's snout",
    "也": "scorpion",
    "亅": "barb / hook",
    "亠": "top hat / lid",
    "儿": "human legs",
    "冂": "hood / upside-down box",
    "冖": "crown / cover",
    "冫": "ice",
    "几": "small table / wind",
    "凵": "open container",
    "勹": "wrap / embrace",
    "匚": "open box (on its side)",
    "卜": "divining rod",
    "卩": "kneeling person / seal",
    "厂": "cliff",
    "厶": "elbow / private",
    "囗": "enclosure / box",
    "夂": "walking legs",
    "宀": "house roof",
    "尸": "reclining body / flag",
    "巛": "winding river",
    "已": "snake / already",
    "巴": "comma shape / mosaic",
    "幺": "cocoon / short thread",
    "广": "cave house / canopy",
    "廴": "long stride",
    "廾": "two hands",
    "弋": "stake / arrow",
    "彡": "hair strokes / shape",
    "彳": "step / going person",
    "戈": "halberd / spear",
    "攵": "taskmaster / strike",
    "メ": "crossed sticks",
    "乍": "saw / brief moment",
    "乚": "fishhook (bent stroke)",
    "歹": "bones / death",
    "殳": "strike / weapon",
    "毋": "do not / pierced mother",
    "气": "breath / steam",
    "爿": "split wood / bed",
    "疋": "bolt of cloth",
    "癶": "departing feet / dotted tent",
    "禾": "grain stalk",
    "而": "rake / beard",
    "耒": "plow",
    "聿": "writing brush",
    "舛": "opposing feet / dance legs",
    "艮": "staring eye / stubborn",
    "豕": "pig",
    "釆": "sorting claw",
    "隹": "small bird / turkey",
    "韋": "tanned leather / opposite walks",
    "髟": "long hair",
    # Obscure sub-components surfaced by KanjiVG's hierarchical breakdown.
    "乡": "bristles / streaks",
    "𠂇": "left hand",
    "龰": "footprint / foot",
    "㐄": "stride / dance step",
    "䒑": "horns / grass top",
    "业": "base / lined up",
    "丂": "obstructed breath",
    "覀": "west (top form)",
    "龶": "sprout (top of 青)",
    "龷": "two-ten top",
    "⺷": "sheep (top)",
    "⻞": "eat / food",
    "𧘇": "clothes (bottom)",
}

# Pure strokes: a grouping candidate made (partly) of these is too easy to
# false-match inside an under-decomposed KRADFILE entry (e.g. 万 = ｜ ノ 一).
STROKES = {"｜", "ノ", "一", "丶", "亅"}

# Hand-fixed decompositions (final display glyphs) where KRADFILE's flat list
# is too poor to recover a meaningful breakdown automatically. Audited against
# the 103 course kanji.
COMPONENT_OVERRIDES = {
    "働": ["⺅", "動"],
    "七": [],
    "万": [],
    "出": ["山", "山"],
    "多": ["夕", "夕"],
    "林": ["木", "木"],
    "森": ["木", "木", "木"],
    "天": ["一", "大"],
    "来": ["一", "米"],
    "母": [],
    "毎": ["𠂉", "母"],
    "海": ["⺡", "毎"],
    "気": ["气", "メ"],
    "新": ["立", "木", "斤"],
    "金": ["𠆢", "王", "丷"],
    "電": ["雨", "田", "乙"],
    "高": ["亠", "口", "冂", "口"],
    "作": ["⺅", "乍"],
    "行": ["彳", "丁"],
    "買": ["⺲", "貝"],
    "礼": ["⺭", "乚"],
    "国": ["囗", "玉"],
    "使": ["⺅", "吏"],
    "薬": ["⺾", "楽"],
}

# Target kanji that the RRTK deck does not contain.
EXTRA_ENTRIES = {
    "嬉": ("delighted", "A woman (女) bursting with joy (喜) is delighted — 嬉しい, happy."),
    "賑": ("bustling", "Money/shells (貝) changing hands from dawn (辰) on — the market is bustling (賑やか)."),
    "醤": ("soy sauce", "A general (将) standing guard over the fermentation jar (酉) of precious soy sauce (醤油)."),
    "鞄": ("bag", "Leather (革) wrapped (包) around your belongings — a bag (鞄)."),
}


def load_kradfile():
    path = os.path.join(KRAD_CACHE, "kradfile")
    if not os.path.exists(path):
        os.makedirs(KRAD_CACHE, exist_ok=True)
        zip_path = os.path.join(KRAD_CACHE, "kradzip.zip")
        subprocess.run(["curl", "-sL", "-m", "60", "-o", zip_path, KRAD_URL], check=True)
        with zipfile.ZipFile(zip_path) as z:
            z.extract("kradfile", KRAD_CACHE)
    krad = {}
    for line in open(path, encoding="euc-jp"):
        if line.startswith("#") or " : " not in line:
            continue
        kanji, comps = line.strip().split(" : ")
        krad[kanji] = [c for c in comps.split(" ") if c != kanji]
    return krad


def load_kanjidic():
    """kanji -> 'オン・オン / くん・くん' (up to 3 on + 3 kun readings)."""
    path = os.path.join(KRAD_CACHE, "kanjidic2.xml")
    if not os.path.exists(path):
        os.makedirs(KRAD_CACHE, exist_ok=True)
        gz_path = path + ".gz"
        subprocess.run(["curl", "-sL", "-m", "120", "-o", gz_path, KANJIDIC_URL], check=True)
        import gzip
        with gzip.open(gz_path, "rb") as src, open(path, "wb") as dst:
            dst.write(src.read())

    readings = {}
    xml = open(path, encoding="utf-8").read()
    for block in re.finditer(r"<literal>(.)</literal>(.*?)</character>", xml, re.S):
        kanji, body = block.group(1), block.group(2)
        on = re.findall(r'<reading r_type="ja_on">([^<]+)</reading>', body)
        kun = re.findall(r'<reading r_type="ja_kun">([^<]+)</reading>', body)
        parts = []
        if on:
            parts.append("・".join(on[:3]))
        if kun:
            parts.append("・".join(kun[:3]))
        if parts:
            readings[kanji] = " / ".join(parts)
    return readings


def clean_html(text):
    text = re.sub(r"<br ?/?>|</div>|</p>", "\n", text)
    text = re.sub(r"<[^>]+>", "", text)
    text = html.unescape(text)
    text = re.sub(r"[ \t ]+", " ", text)
    text = re.sub(r"\s*\n\s*", "\n", text).strip()
    return text


def load_rrtk():
    rrtk = {}
    with tempfile.TemporaryDirectory() as tmp:
        with zipfile.ZipFile(APKG) as z:
            z.extract("collection.anki2", tmp)
        con = sqlite3.connect(os.path.join(tmp, "collection.anki2"))
        for (flds,) in con.execute("select flds from notes"):
            parts = flds.split("\x1f")
            if len(parts) < 5:
                continue
            kanji = parts[0].strip()
            if len(kanji) != 1 or not is_kanji(kanji):
                continue
            rrtk[kanji] = {
                "keyword": clean_html(parts[1]),
                "story": clean_html(parts[2]),
            }
        con.close()
    return rrtk


def load_targets():
    kanji_md = open(os.path.join(RAW, "kanji", "kanji_all_103.md")).read()
    course = set()
    for m in re.finditer(r"^### \d{2,3} (.+)$", kanji_md, re.M):
        ch = m.group(1)[0]
        if is_kanji(ch):
            course.add(ch)
    vocab_chars = set()
    for name in ("vocab_part1.md", "vocab_part2.md", "vocab_part3.md"):
        text = open(os.path.join(RAW, "vocab", name)).read()
        for m in re.finditer(r"^\d{3}\s+(.+?)\s+—", text, re.M):
            vocab_chars.update(ch for ch in m.group(1) if is_kanji(ch))
    return course, vocab_chars


_closure_cache = {}


def closure(ch, krad):
    if ch in _closure_cache:
        return _closure_cache[ch]
    seen = set()
    _closure_cache[ch] = seen  # guard against cycles
    for sub in krad.get(ch, []):
        if sub != ch:
            seen.add(sub)
            seen.update(closure(sub, krad))
    return seen


def top_level_components(kanji, krad):
    """KRADFILE lists every visible element flat (話 -> 口 舌 言). Keep only the
    components not contained in another listed component, giving the natural
    one-level decomposition (話 -> 言 舌)."""
    comps = [c for c in dict.fromkeys(krad.get(kanji, [])) if c != kanji]
    return [c for c in comps if not any(c in closure(d, krad) for d in comps if d != c)]


def greedy_group(kanji, comps, candidates):
    original = set(comps)
    remaining = list(comps)
    changed = True
    while changed:
        changed = False
        for cand, cand_comps in candidates:
            if cand == kanji or cand in remaining:
                continue
            if len(cand_comps) < 2 or not cand_comps.issubset(remaining):
                continue
            if cand_comps >= original:  # never swallow the whole decomposition
                continue
            index = min(remaining.index(c) for c in cand_comps)
            remaining = [c for c in remaining if c not in cand_comps]
            remaining.insert(min(index, len(remaining)), cand)
            changed = True
            break
    return remaining


def group_components(kanji, comps, candidates):
    """KRADFILE sometimes omits the natural intermediate part (時 -> 寸 土 日,
    missing 寺). Greedily recombine subsets of components that exactly form a
    known kanji, so 時 becomes 日 + 寺 and 草 becomes ⺾ + 早.

    Leftover bare strokes after grouping are a strong signal that a candidate
    stole pieces of an element KRADFILE never listed (働 has no 里, so 但 would
    "match"). In that case retry with stroke-free candidates only, and if
    strokes still remain, keep the ungrouped original."""
    grouped = greedy_group(kanji, comps, candidates)
    if grouped != comps and any(c in STROKES for c in grouped):
        safe = [(c, cc) for c, cc in candidates if not cc & STROKES]
        grouped = greedy_group(kanji, comps, safe)
        if any(c in STROKES for c in grouped):
            return comps
    return grouped


def load_kanjivg():
    """Download (if needed) and parse KanjiVG, returning {kanji_char: top <g> node}."""
    xml_path = os.path.join(KANJIVG_CACHE, "kanjivg.xml")
    if not os.path.exists(xml_path):
        os.makedirs(KANJIVG_CACHE, exist_ok=True)
        with urllib.request.urlopen(KANJIVG_RELEASES_API, timeout=30) as resp:
            release = json.load(resp)
        url = next(a["browser_download_url"] for a in release["assets"] if a["name"].endswith(".xml.gz"))
        print(f"Downloading KanjiVG {url} ...")
        with urllib.request.urlopen(url, timeout=120) as resp:
            data = gzip.decompress(resp.read())
        with open(xml_path, "wb") as f:
            f.write(data)
    root = ET.parse(xml_path).getroot()
    tops = {}
    for kanji in root.iter("kanji"):
        g = kanji.find("g")
        if g is None:
            continue
        el = g.get(KANJIVG_NS + "element")
        if el and el not in tops:
            tops[el] = g
    return tops


def kvg_components(kanji, kvg, resolvable):
    """First-level decomposition of `kanji` from its KanjiVG tree.

    Descends through anonymous wrapper groups, and through *named* fragments that
    aren't learner-meaningful (obscure phonetic parts with no keyword/radical name),
    so the chips are always recognizable components. Radical glyphs are normalized
    to the curated CJK-Radicals-Supplement forms. Repeated parts are kept (森 -> 木 + 林)."""
    top = kvg.get(kanji)
    if top is None:
        return None

    def walk(node):
        out = []
        for child in node.findall("g"):
            el = child.get(KANJIVG_NS + "element")
            el = KVG_NORMALIZE.get(el, el) if el else el
            has_children = child.find("g") is not None
            if el is None:
                out.extend(walk(child))                 # anonymous wrapper -> descend
            elif resolvable(el):
                out.append(el)                          # recognizable component
            elif has_children:
                sub = walk(child)                       # obscure fragment -> descend
                out.extend(sub if sub else [el])
            else:
                out.append(el)                          # atomic leaf -> keep as-is
        return out

    comps = walk(top)
    # Fewer than two parts isn't a real breakdown (e.g. KanjiVG isolating a single
    # variant glyph) — treat the kanji as atomic rather than show a one-chip "→".
    if len(comps) < 2 or comps == [kanji]:
        return []
    return comps


def main(full=False):
    krad = load_kradfile()
    rrtk = load_rrtk()
    kanjidic = load_kanjidic()
    kvg = load_kanjivg()
    course, vocab_chars = load_targets()
    if full:
        # Lookup dataset: every kanji with an RRTK story, plus the N5 set (so the
        # course's hand-audited overrides/readings are always present), plus any
        # component pulled in by the recursive grouping below.
        targets = set(rrtk) | course | vocab_chars
    else:
        targets = course | vocab_chars

    # Radical meanings (curated table + placeholder remaps). Built up front so the
    # KanjiVG descent can tell a "named" radical from an obscure phonetic fragment.
    radicals = dict(RADICAL_MEANINGS)
    for glyph, meaning in PLACEHOLDER_RADICALS.values():
        radicals[glyph] = meaning

    # A component is "resolvable" (stop descending, show it as a chip) when it has a
    # learner-facing name: an RRTK keyword or a curated radical meaning.
    def resolvable(el):
        return el in rrtk or el in radicals

    # KRADFILE grouping candidates (fallback path only): every RRTK kanji with a
    # multi-part decomposition, biggest first so the greedy pass consumes large groups
    candidates = []
    for cand in rrtk:
        if cand in krad and cand not in PLACEHOLDER_RADICALS:
            cand_comps = frozenset(top_level_components(cand, krad))
            if len(cand_comps) >= 2 and cand_comps - STROKES:
                candidates.append((cand, cand_comps))
    candidates.sort(key=lambda item: (-len(item[1]), item[0]))

    # --- RTK-first decomposition (validated against KanjiVG structure) ---
    # The RRTK story names its primitives in parentheses, e.g. "water (氵)". When
    # those named parts are all structurally real (appear inside the kanji per
    # KanjiVG) the chips can match the mnemonic exactly. But Heisig also teaches
    # some kanji by analogy to a *sister* kanji (歴 → "like calendar (暦)…"), which
    # names non-components — so every story primitive is validated against the
    # kanji's KanjiVG structural closure, and anything that doesn't check out
    # falls back to the plain KanjiVG decomposition.
    closure_cache = {}

    def kvg_closure(kanji):
        if kanji in closure_cache:
            return closure_cache[kanji]
        closure_cache[kanji] = set()  # cycle guard
        top = kvg.get(kanji)
        if top is None:
            return closure_cache[kanji]
        direct = set()

        def walk(node):
            for child in node.findall("g"):
                el = child.get(KANJIVG_NS + "element")
                if el:
                    direct.add(KVG_NORMALIZE.get(el, el))
                walk(child)

        walk(top)
        full = set(direct)
        for el in direct:
            if el != kanji:
                full |= kvg_closure(el)
        closure_cache[kanji] = full
        return full

    paren_re = re.compile(r"[（(]([^（）()]*)[)）]")

    def story_components(kanji, story):
        """Primitive glyphs the RRTK story names in parentheses (normalized, in
        order, excluding the kanji itself)."""
        out = []
        for inner in paren_re.findall(story or ""):
            for ch in inner:
                if is_kanji(ch) or ch in radicals:
                    glyph = KVG_NORMALIZE.get(ch, ch)
                    if glyph != kanji and glyph not in out:
                        out.append(glyph)
        return out

    def decompose(kanji):
        """RTK story primitives when they're a valid (≥2-part, structurally real,
        resolvable) decomposition; otherwise the KanjiVG breakdown (or None)."""
        info = rrtk.get(kanji)
        if info:
            sprims = story_components(kanji, info.get("story", ""))
            if len(sprims) >= 2:
                clo = kvg_closure(kanji)
                if clo and all(p in clo for p in sprims) and all(resolvable(p) for p in sprims):
                    return sprims
        return kvg_components(kanji, kvg, resolvable)

    # entries: all targets, plus any component (after decomposition) with RRTK data
    entries = {}
    unresolved = set()
    queue = sorted(t for t in targets if t in krad or t in rrtk or t in kvg or t in EXTRA_ENTRIES)
    while queue:
        kanji = queue.pop(0)
        if kanji in entries:
            continue
        comps = []
        if kanji in COMPONENT_OVERRIDES:
            # Hand-audited breakdowns win (e.g. 七 stays atomic, not 一 + 乙).
            comps = list(COMPONENT_OVERRIDES[kanji])
            for c in comps:
                if c in rrtk and c not in entries:
                    queue.append(c)
        else:
            kvg_comps = decompose(kanji)
            if kvg_comps is not None:
                # Primary path: validated RTK-story primitives, else KanjiVG.
                for c in kvg_comps:
                    comps.append(c)
                    if (c in rrtk or c in kvg) and c not in entries and c not in radicals:
                        queue.append(c)
                    elif c not in rrtk and c not in radicals:
                        unresolved.add(c)
            else:
                # Fallback: KRADFILE grouping for the few kanji KanjiVG lacks.
                raw_comps = group_components(kanji, top_level_components(kanji, krad), candidates)
                for c in raw_comps:
                    if c in PLACEHOLDER_RADICALS:
                        glyph, _meaning = PLACEHOLDER_RADICALS[c]
                        comps.append(glyph)
                    else:
                        comps.append(c)
                        if c in rrtk and c not in entries:
                            queue.append(c)
                        elif c not in rrtk and c not in RADICAL_MEANINGS:
                            unresolved.add(c)
        info = rrtk.get(kanji)
        extra = EXTRA_ENTRIES.get(kanji)
        entry = {
            "keyword": info["keyword"] if info else (extra[0] if extra else ""),
            "story": info["story"] if info else (extra[1] if extra else ""),
            "components": comps,
        }
        if kanji in kanjidic:
            entry["readings"] = kanjidic[kanji]
        if kanji in course:
            entry["inCourse"] = True
        entries[kanji] = entry
    entries = dict(sorted(entries.items()))

    # Every radical gets its own lightweight entry so component chips are
    # always tappable (e.g. 家 -> 宀 + 豕, neither of which is an RRTK kanji).
    for glyph, meaning in radicals.items():
        if glyph in entries:
            continue
        entry = {
            "keyword": meaning,
            "story": "",
            "components": [],
            "isRadical": True,
        }
        if glyph in kanjidic:
            entry["readings"] = kanjidic[glyph]
        entries[glyph] = entry
    entries = dict(sorted(entries.items()))

    if unresolved:
        print("WARNING: components without meaning:", "".join(sorted(unresolved)))

    if full:
        # Compact JSON superset for the lookup feature (lazy-loaded, not bundled).
        os.makedirs(os.path.dirname(OUT_JSON), exist_ok=True)
        with open(OUT_JSON, "w") as f:
            json.dump(
                {"radicals": radicals, "insights": entries},
                f,
                ensure_ascii=False,
                separators=(",", ":"),
            )
        out = OUT_JSON
    else:
        with open(OUT, "w") as f:
            f.write("// GENERATED FILE — do not edit by hand.\n")
            f.write("// Built by scripts/build-kanji-insights.py from KRADFILE (EDRDG,\n")
            f.write("// https://www.edrdg.org/edrdg/licence.html) and the RRTK deck in the repo root.\n\n")
            f.write("export interface KanjiInsight {\n")
            f.write("  keyword: string;\n")
            f.write("  story: string;\n")
            f.write("  components: string[];\n")
            f.write("  readings?: string;\n")
            f.write("  inCourse?: boolean;\n")
            f.write("  isRadical?: boolean;\n")
            f.write("}\n\n")
            f.write("export const RADICAL_MEANINGS: Record<string, string> = ")
            f.write(json.dumps(radicals, ensure_ascii=False, indent=2))
            f.write(";\n\n")
            f.write("export const KANJI_INSIGHTS: Record<string, KanjiInsight> = ")
            f.write(json.dumps(entries, ensure_ascii=False, indent=2))
            f.write(";\n")
        out = OUT

    print(f"Wrote {out}: {len(entries)} kanji entries, {len(radicals)} radical meanings")
    in_course = sum(1 for e in entries.values() if e.get("inCourse"))
    no_story = [k for k, e in entries.items() if not e["story"]]
    print(f"  course kanji: {in_course}, entries without story: {len(no_story)} {''.join(no_story[:30])}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Generate kanji decomposition + mnemonic data.")
    parser.add_argument(
        "--full",
        action="store_true",
        help="Build the full-RTK JSON superset for lookup (public/data/kanji-insights-full.json) "
        "instead of the N5 course .ts file.",
    )
    args = parser.parse_args()
    main(full=args.full)
