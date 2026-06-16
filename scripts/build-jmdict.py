#!/usr/bin/env python3
"""Generate public/data/jmdict.json — the offline vocab dataset for lookup.

Source: jmdict-simplified (https://github.com/scriptin/jmdict-simplified), the
"jmdict-examples-eng" release, which is JMdict (EDRDG) converted to JSON with
Tatoeba example sentences linked to each sense.

We keep only "common" entries (any kanji/kana form flagged common — ~30k of 217k)
and emit a compact shape with one representative example sentence per entry, so
the bundled dataset stays small and lazy-loads on first lookup.

Output entry shape:
  { "id": str,
    "k":  [str],                 # kanji surface forms (may be empty for kana words)
    "r":  [str],                 # kana readings
    "s":  [{ "pos": [str], "g": [str] }],   # senses: part-of-speech codes + glosses
    "ex": { "j": str, "e": str } | absent }  # one example (jp + en)

Usage: python3 scripts/build-jmdict.py
Requires network only if the source file is not cached in /tmp/jmdict-cache.
"""

import json
import os
import subprocess
import sys
import urllib.request
import zipfile

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(REPO, "public", "data", "jmdict.json")
CACHE = "/tmp/jmdict-cache"
SRC = os.path.join(CACHE, "jmdict-examples.json")
RELEASES_API = "https://api.github.com/repos/scriptin/jmdict-simplified/releases/latest"


def ensure_source():
    """Download + unzip the jmdict-examples-eng release into the cache if absent."""
    if os.path.exists(SRC):
        return
    os.makedirs(CACHE, exist_ok=True)
    print("Resolving latest jmdict-simplified release ...")
    with urllib.request.urlopen(RELEASES_API, timeout=30) as resp:
        release = json.load(resp)
    url = next(
        a["browser_download_url"]
        for a in release["assets"]
        if a["name"].startswith("jmdict-examples-eng") and a["name"].endswith(".json.zip")
    )
    zip_path = os.path.join(CACHE, "jmdict-examples.json.zip")
    print(f"Downloading {url} ...")
    urllib.request.urlretrieve(url, zip_path)
    with zipfile.ZipFile(zip_path) as zf:
        name = next(n for n in zf.namelist() if n.endswith(".json"))
        zf.extract(name, CACHE)
        os.replace(os.path.join(CACHE, name), SRC)
    print(f"Cached source at {SRC}")


def is_common(word):
    return any(f.get("common") for f in word.get("kanji", [])) or any(
        f.get("common") for f in word.get("kana", [])
    )


def pick_example(word):
    """First Tatoeba example across the entry's senses, as {j, e}."""
    for sense in word.get("sense", []):
        for ex in sense.get("examples", []):
            jp = next((s["text"] for s in ex.get("sentences", []) if s.get("lang") == "jpn"), None)
            en = next((s["text"] for s in ex.get("sentences", []) if s.get("lang") == "eng"), None)
            if jp and en:
                return {"j": jp, "e": en}
    return None


def main():
    ensure_source()
    print("Loading source ...")
    with open(SRC) as f:
        data = json.load(f)

    words_out = []
    for word in data["words"]:
        if not is_common(word):
            continue
        senses = []
        for sense in word.get("sense", []):
            glosses = [g["text"] for g in sense.get("gloss", []) if g.get("text")]
            if not glosses:
                continue
            senses.append({"pos": sense.get("partOfSpeech", []), "g": glosses})
        if not senses:
            continue
        entry = {
            "id": word["id"],
            "k": [f["text"] for f in word.get("kanji", [])],
            "r": [f["text"] for f in word.get("kana", [])],
            "s": senses,
        }
        ex = pick_example(word)
        if ex:
            entry["ex"] = ex
        words_out.append(entry)

    # part-of-speech code -> human label, for the UI (small; only POS tags kept)
    pos_codes = {p for w in words_out for s in w["s"] for p in s["pos"]}
    tags = {k: v for k, v in data.get("tags", {}).items() if k in pos_codes}

    out = {
        "version": data.get("version"),
        "tags": tags,
        "words": words_out,
    }
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w") as f:
        json.dump(out, f, ensure_ascii=False, separators=(",", ":"))

    with_ex = sum(1 for w in words_out if "ex" in w)
    print(f"Wrote {OUT}: {len(words_out)} common entries ({with_ex} with examples), {len(tags)} POS tags")


if __name__ == "__main__":
    main()
