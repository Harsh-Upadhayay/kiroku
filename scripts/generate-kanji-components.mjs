import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Kanji from "kanji.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const corpusPath = path.join(__dirname, "kanji-component-corpus.txt");
const outputPath = path.join(root, "src/data/kanji-components.generated.ts");
const cacheDir = path.join(root, ".cache/kanjivg");

const sourceBase = "https://raw.githubusercontent.com/KanjiVG/kanjivg/master/kanji";

const componentAliases = {
  "亻": { keyword: "person", displayName: "person variant", variantGroup: "人", strokeCount: 2 },
  "氵": { keyword: "water", displayName: "water variant", variantGroup: "水", strokeCount: 3 },
  "扌": { keyword: "hand", displayName: "hand variant", variantGroup: "手", strokeCount: 3 },
  "忄": { keyword: "heart", displayName: "heart variant", variantGroup: "心", strokeCount: 3 },
  "艹": { keyword: "grass", displayName: "grass crown", variantGroup: "艸", strokeCount: 3 },
  "⻌": { keyword: "movement", displayName: "movement road", variantGroup: "辵", strokeCount: 3 },
  "辶": { keyword: "movement", displayName: "movement road", variantGroup: "辵", strokeCount: 3 },
  "⺾": { keyword: "grass", displayName: "grass crown", variantGroup: "艸", strokeCount: 3 },
  "⺮": { keyword: "bamboo", displayName: "bamboo crown", variantGroup: "竹", strokeCount: 6 },
  "⺩": { keyword: "jewel", displayName: "jewel variant", variantGroup: "玉", strokeCount: 4 },
  "礻": { keyword: "altar", displayName: "altar sign", variantGroup: "示", strokeCount: 4 },
  "衤": { keyword: "clothing", displayName: "clothing sign", variantGroup: "衣", strokeCount: 5 },
  "⺼": { keyword: "flesh", displayName: "flesh moon", variantGroup: "肉", strokeCount: 4 },
  "刂": { keyword: "knife", displayName: "knife side", variantGroup: "刀", strokeCount: 2 },
  "灬": { keyword: "fire", displayName: "fire dots", variantGroup: "火", strokeCount: 4 },
  "宀": { keyword: "roof", displayName: "roof", variantGroup: "宀", strokeCount: 3 },
  "囗": { keyword: "enclosure", displayName: "enclosure", variantGroup: "囗", strokeCount: 3 },
  "冫": { keyword: "ice", displayName: "ice", variantGroup: "冰", strokeCount: 2 },
  "讠": { keyword: "speech", displayName: "speech variant", variantGroup: "言", strokeCount: 2 },
  "言": { keyword: "speech", displayName: "speech", variantGroup: "言", strokeCount: 7 },
  "糸": { keyword: "thread", displayName: "thread", variantGroup: "糸", strokeCount: 6 },
  "攵": { keyword: "strike", displayName: "strike", variantGroup: "攴", strokeCount: 4 },
  "阝": { keyword: "mound", displayName: "mound/city", variantGroup: "阜", strokeCount: 3 },
  "犭": { keyword: "animal", displayName: "animal", variantGroup: "犬", strokeCount: 3 },
  "疒": { keyword: "sickness", displayName: "sickness", variantGroup: "疒", strokeCount: 5 },
  "罒": { keyword: "net", displayName: "net", variantGroup: "网", strokeCount: 5 },
  "𠆢": { keyword: "person", displayName: "person crown", variantGroup: "人", strokeCount: 2 },
};

function codePointName(character) {
  return character.codePointAt(0).toString(16).padStart(5, "0");
}

async function readCorpus() {
  const raw = await fs.readFile(corpusPath, "utf8");
  return Array.from(new Set(Array.from(raw).filter((char) => /\p{Script=Han}/u.test(char)))).sort();
}

async function readSvg(character) {
  await fs.mkdir(cacheDir, { recursive: true });
  const code = codePointName(character);
  const cachePath = path.join(cacheDir, `${code}.svg`);
  try {
    return await fs.readFile(cachePath, "utf8");
  } catch {
    const response = await fetch(`${sourceBase}/${code}.svg`);
    if (!response.ok) return "";
    const svg = await response.text();
    await fs.writeFile(cachePath, svg);
    return svg;
  }
}

function parseAttrs(input) {
  const attrs = {};
  input.replace(/([\w:.-]+)="([^"]*)"/g, (_match, key, value) => {
    attrs[key] = value;
    return "";
  });
  return attrs;
}

function parseDecomposition(character, svg) {
  const groups = [];
  for (const match of svg.matchAll(/<g\b([^>]*)>/g)) {
    const attrs = parseAttrs(match[1]);
    const element = attrs["kvg:element"];
    if (!element || element === character) continue;
    groups.push({
      component: element,
      original: attrs["kvg:original"] || "",
      position: attrs["kvg:position"] || "",
      radical: attrs["kvg:radical"] || "",
    });
  }

  const seen = new Set();
  const ordered = [];
  for (const group of groups) {
    const key = `${group.component}:${group.position}`;
    if (seen.has(key)) continue;
    seen.add(key);
    ordered.push(group);
  }

  const radicalGroup = ordered.find((group) => group.radical);
  return {
    kanji: character,
    components: ordered.map((group) => group.component),
    radical: radicalGroup?.component,
    layout: ordered.map((group) => ({
      component: group.component,
      original: group.original || undefined,
      position: group.position || undefined,
      radical: group.radical || undefined,
    })),
    source: "kanjivg",
  };
}

function kanjiDetails(character) {
  try {
    const details = Kanji.getDetails(character);
    if (details?.literal) return details;
  } catch {
    return null;
  }
  return null;
}

function describeComponent(glyph, source, variantGroup = "") {
  const alias = componentAliases[glyph] || (variantGroup ? componentAliases[variantGroup] : undefined);
  const lookupGlyph = alias?.variantGroup || variantGroup || glyph;
  const details = kanjiDetails(lookupGlyph) || kanjiDetails(glyph);
  const keyword = alias?.keyword || details?.meanings?.[0] || "component";
  return {
    glyph,
    displayName: alias?.displayName || keyword,
    keyword,
    strokeCount: alias?.strokeCount || details?.stroke_count || 0,
    variantGroup: alias?.variantGroup || variantGroup || glyph,
    source,
  };
}

function stableJson(value) {
  return JSON.stringify(value, null, 2);
}

async function main() {
  const corpus = await readCorpus();
  const decompositions = {};
  const components = {};

  let completed = 0;
  const concurrency = 20;
  const queue = [...corpus];

  async function worker() {
    while (queue.length) {
      const kanji = queue.shift();
      const svg = await readSvg(kanji);
      if (svg) {
        const decomposition = parseDecomposition(kanji, svg);
        decompositions[kanji] = decomposition;
        for (const item of decomposition.layout) {
          components[item.component] = describeComponent(item.component, "kanjivg", item.original);
        }
      }
      completed += 1;
      if (completed % 100 === 0) {
        process.stdout.write(`processed ${completed}/${corpus.length}\n`);
      }
    }
  }

  await Promise.all(Array.from({ length: concurrency }, worker));

  for (const [glyph, alias] of Object.entries(componentAliases)) {
    components[glyph] = { ...describeComponent(glyph, "alias", alias.variantGroup), ...components[glyph] };
  }

  const header = `// Generated by scripts/generate-kanji-components.mjs.\n// Source: KanjiVG (https://kanjivg.tagaini.net/), CC BY-SA 3.0.\n// Do not edit by hand; regenerate after changing scripts/kanji-component-corpus.txt.\n\n`;
  const body = `import type { KanjiComponent, KanjiDecomposition } from "../utils/anki-v3";\n\nexport const KANJI_COMPONENT_SOURCE_NOTICE = "Component and stroke metadata derived from KanjiVG, copyright Ulrich Apel, CC BY-SA 3.0.";\n\nexport const KANJI_COMPONENTS = ${stableJson(Object.fromEntries(Object.entries(components).sort(([a], [b]) => a.localeCompare(b))))} satisfies Record<string, KanjiComponent>;\n\nexport const KANJI_DECOMPOSITIONS = ${stableJson(Object.fromEntries(Object.entries(decompositions).sort(([a], [b]) => a.localeCompare(b))))} satisfies Record<string, KanjiDecomposition>;\n`;

  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, header + body);
  console.log(`wrote ${outputPath}`);
  console.log(`${Object.keys(decompositions).length} decompositions, ${Object.keys(components).length} components`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
