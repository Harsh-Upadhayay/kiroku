#!/usr/bin/env python3
"""Generate src/content/n5/kanji-insights.ts — kanji decomposition + mnemonic data.

Scope: every kanji taught in the N5 course (src/content/n5/raw/kanji) plus every
kanji that appears in N5 vocab words, plus any component of those kanji that has
its own RRTK entry (so the breakdown UI can drill down).

Data sources:
  - Component decomposition: KRADFILE (EDRDG, http://ftp.edrdg.org/pub/Nihongo/kradzip.zip)
  - Keywords + mnemonic stories: RRTK_Recognition_Remembering_The_Kanji.apkg (repo root)
  - Radical meanings: curated table below (RTK-style learner names)

Usage: python3 scripts/build-kanji-insights.py
Requires network only if /tmp/kradzip-cache/kradfile is absent.
"""

import html
import json
import os
import re
import sqlite3
import subprocess
import sys
import tempfile
import zipfile

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = os.path.join(REPO, "src", "content", "n5", "raw")
APKG = os.path.join(REPO, "RRTK_Recognition_Remembering_The_Kanji.apkg")
OUT = os.path.join(REPO, "src", "content", "n5", "kanji-insights.ts")
KRAD_CACHE = "/tmp/kradzip-cache"
KRAD_URL = "http://ftp.edrdg.org/pub/Nihongo/kradzip.zip"

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


def main():
    krad = load_kradfile()
    rrtk = load_rrtk()
    course, vocab_chars = load_targets()
    targets = course | vocab_chars

    # grouping candidates: every RRTK kanji with a multi-part decomposition,
    # biggest decompositions first so the greedy pass consumes large groups
    candidates = []
    for cand in rrtk:
        if cand in krad and cand not in PLACEHOLDER_RADICALS:
            cand_comps = frozenset(top_level_components(cand, krad))
            if len(cand_comps) >= 2 and cand_comps - STROKES:
                candidates.append((cand, cand_comps))
    candidates.sort(key=lambda item: (-len(item[1]), item[0]))

    # entries: all targets, plus any component (after grouping) with RRTK data
    entries = {}
    unresolved = set()
    queue = sorted(t for t in targets if t in krad or t in rrtk or t in EXTRA_ENTRIES)
    while queue:
        kanji = queue.pop(0)
        if kanji in entries:
            continue
        comps = []
        if kanji in COMPONENT_OVERRIDES:
            comps = list(COMPONENT_OVERRIDES[kanji])
            for c in comps:
                if c in rrtk and c not in entries:
                    queue.append(c)
        else:
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
        if kanji in course:
            entry["inCourse"] = True
        entries[kanji] = entry
    entries = dict(sorted(entries.items()))

    radicals = dict(RADICAL_MEANINGS)
    for glyph, meaning in PLACEHOLDER_RADICALS.values():
        radicals[glyph] = meaning

    if unresolved:
        print("WARNING: components without meaning:", "".join(sorted(unresolved)))

    with open(OUT, "w") as f:
        f.write("// GENERATED FILE — do not edit by hand.\n")
        f.write("// Built by scripts/build-kanji-insights.py from KRADFILE (EDRDG,\n")
        f.write("// https://www.edrdg.org/edrdg/licence.html) and the RRTK deck in the repo root.\n\n")
        f.write("export interface KanjiInsight {\n")
        f.write("  keyword: string;\n")
        f.write("  story: string;\n")
        f.write("  components: string[];\n")
        f.write("  inCourse?: boolean;\n")
        f.write("}\n\n")
        f.write("export const RADICAL_MEANINGS: Record<string, string> = ")
        f.write(json.dumps(radicals, ensure_ascii=False, indent=2))
        f.write(";\n\n")
        f.write("export const KANJI_INSIGHTS: Record<string, KanjiInsight> = ")
        f.write(json.dumps(entries, ensure_ascii=False, indent=2))
        f.write(";\n")

    print(f"Wrote {OUT}: {len(entries)} kanji entries, {len(radicals)} radical meanings")
    in_course = sum(1 for e in entries.values() if e.get("inCourse"))
    no_story = [k for k, e in entries.items() if not e["story"]]
    print(f"  course kanji: {in_course}, entries without story: {len(no_story)} {''.join(no_story[:30])}")


if __name__ == "__main__":
    main()
