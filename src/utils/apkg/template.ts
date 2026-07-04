// Plain-text card preview rendering, mirroring backend/internal/anki/template.go. The parser
// runs this over every card during an import, so the regexes live at module scope, compiled
// once — same reasoning as the Go package hoisting them out of the hot path.

import type { ApkgNote, ApkgNoteType } from "./types";
import { first, secondOrFirst } from "./coerce";

// Each regex is a direct port of its Go counterpart; Go's (?s) flag becomes [\s\S].
const reConditionalSection = /\{\{#([^}]+)\}\}([\s\S]*?)\{\{\/([^}]+)\}\}/g;
const reInvertedSection = /\{\{\^([^}]+)\}\}([\s\S]*?)\{\{\/([^}]+)\}\}/g;
const reFieldRef = /\{\{(?:[^}:]+:)*([^}]+)\}\}/g;
const reDigitsOnly = /^\d+$/;
const reSoundTag = /\[sound:[^\]]+\]/gi;
const reBlockBreak = /<br\s*\/?>|<\/p>|<\/div>/gi;
const reHTMLTag = /<[^>]+>/g;
const reJapanese = /[一-龯぀-ゟ゠-ヿ＀-ﾟ]/;
const reNumericEntity = /&#(x[0-9a-fA-F]+|\d+);/g;
const reNamedEntity = /&([a-zA-Z]+);/g;

// Go uses html.UnescapeString, which knows every HTML5 named entity. Shipping that table to
// the browser isn't worth it for plain-text previews; this covers the entities that occur in
// real decks. An unknown named entity passes through unchanged — a cosmetic divergence in the
// preview text only, never in the card's actual fields (those keep their raw HTML).
const namedEntities: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
  copy: "©", reg: "®", trade: "™", hellip: "…",
  mdash: "—", ndash: "–", lsquo: "‘", rsquo: "’",
  ldquo: "“", rdquo: "”", middot: "·", bull: "•",
  deg: "°", plusmn: "±", frac12: "½", times: "×",
  divide: "÷",
};

function unescapeEntities(input: string): string {
  return input
    .replace(reNumericEntity, (_, code: string) => {
      const n = code[0] === "x" || code[0] === "X" ? parseInt(code.slice(1), 16) : parseInt(code, 10);
      return Number.isNaN(n) ? _ : String.fromCodePoint(n);
    })
    .replace(reNamedEntity, (match, name: string) => namedEntities[name] ?? match);
}

/**
 * previewFrontBack produces a plain-text front/back preview for a card: template render
 * first, then the field heuristic when that yields nothing usable (Go: previewFrontBack).
 */
export function previewFrontBack(note: ApkgNote, model: ApkgNoteType | undefined, ord: number): [string, string] {
  const templates = model?.templates ?? [];
  if (ord >= 0 && ord < templates.length) {
    const tmpl = templates[ord];
    const front = cleanHTML(renderSimpleTemplate(tmpl.qfmt, note));
    const back = cleanHTML(renderSimpleTemplate(tmpl.afmt, note));
    if (front !== "" && back !== "") return [front, back];
  }
  const plainFields: string[] = [];
  for (const name of note.fieldOrder) {
    const plain = cleanHTML(note.fields[name] ?? "");
    if (plain !== "" && !reDigitsOnly.test(plain)) plainFields.push(plain);
  }
  return pickFrontBack(plainFields);
}

/**
 * renderSimpleTemplate implements the subset of Anki's template syntax the previews need:
 * {{#Field}}/{{^Field}} sections and {{Field}} substitution with "filter:" prefixes ignored.
 * {{FrontSide}} is dropped because question and answer render independently.
 */
export function renderSimpleTemplate(format: string, note: ApkgNote): string {
  let out = format.replace(reConditionalSection, (match, open: string, body: string, close: string) => {
    if (open !== close) return match;
    return (note.fields[open] ?? "").trim() === "" ? "" : body;
  });
  out = out.replace(reInvertedSection, (match, open: string, body: string, close: string) => {
    if (open !== close) return match;
    return (note.fields[open] ?? "").trim() !== "" ? "" : body;
  });
  out = out.replaceAll("{{FrontSide}}", "");
  return out.replace(reFieldRef, (_match, name: string) => note.fields[name.trim()] ?? "");
}

/** cleanHTML reduces an HTML field value to readable plain text (Go: cleanHTML). */
export function cleanHTML(input: string): string {
  const noSound = input.replace(reSoundTag, "");
  const noBreaks = noSound.replace(reBlockBreak, "\n");
  const noTags = noBreaks.replace(reHTMLTag, "");
  return unescapeEntities(noTags).trim();
}

/**
 * pickFrontBack guesses prompt/answer fields when template rendering fails, assuming a
 * Japanese study deck: first Japanese field is the front, an English field the back.
 */
export function pickFrontBack(fields: string[]): [string, string] {
  if (fields.length === 0) return ["", ""];
  const japanese: string[] = [];
  const english: string[] = [];
  for (const field of fields) {
    (reJapanese.test(field) ? japanese : english).push(field);
  }
  if (japanese.length > 0) {
    let back = first(english);
    if (back === "" && japanese.length > 1) back = japanese[1];
    if (back === "") back = japanese[0];
    return [japanese[0], back];
  }
  return [fields[0], secondOrFirst(fields)];
}
