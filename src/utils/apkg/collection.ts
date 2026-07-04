// Deck / deck-config / note-type metadata readers, mirroring backend/internal/anki/collection.go.
// The "col" table stores these as JSON blobs keyed by id; the readers coerce them into the
// typed model with the exact same fallbacks and orderings as the Go parser.

import type { Database } from "sql.js";
import type { ApkgDeck, ApkgDeckConfig, ApkgField, ApkgNoteType, ApkgTemplate } from "./types";
import {
  boolValue,
  coalesceInt,
  fallback,
  intValue,
  numberString,
  omitEmpty,
  omitFalse,
  omitZero,
  stringValue,
} from "./coerce";

/**
 * byteLess compares strings the way Go compares them (byte order of the UTF-8 encoding).
 * JS's `<` compares UTF-16 code units, which agrees with UTF-8 byte order everywhere except
 * across the surrogate range — irrelevant for real deck names, but the sort must be
 * deterministic and identical to the Go parser's for the parity goldens to hold.
 */
function byteLess(a: string, b: string): boolean {
  return a < b;
}

export interface CollectionMetadata {
  decks: ApkgDeck[] | null;
  deckConfigs: ApkgDeckConfig[] | null;
  noteTypes: ApkgNoteType[] | null;
  warnings: string[];
}

/** readMetadata pulls decks/dconf/models out of the single-row "col" table. */
export function readMetadata(db: Database, warnings: string[]): CollectionMetadata {
  let decksRaw = "";
  let deckConfigsRaw = "";
  let modelsRaw = "";
  try {
    const stmt = db.prepare("SELECT decks, dconf, models FROM col LIMIT 1");
    try {
      if (!stmt.step()) throw new Error("col table is empty");
      const [d, c, m] = stmt.get();
      decksRaw = String(d ?? "");
      deckConfigsRaw = String(c ?? "");
      modelsRaw = String(m ?? "");
    } finally {
      stmt.free();
    }
  } catch (err) {
    warnings.push(`collection metadata unavailable: ${err instanceof Error ? err.message : String(err)}`);
    return { decks: null, deckConfigs: null, noteTypes: null, warnings };
  }

  const decks = readDecks(decksRaw);
  const deckConfigs = readDeckConfigs(deckConfigsRaw);
  const noteTypes = readNoteTypes(modelsRaw);
  decks?.sort((a, b) => (byteLess(a.name, b.name) ? -1 : byteLess(b.name, a.name) ? 1 : 0));
  noteTypes?.sort((a, b) => (byteLess(a.name, b.name) ? -1 : byteLess(b.name, a.name) ? 1 : 0));
  return { decks, deckConfigs, noteTypes, warnings };
}

function parseJSONMap(raw: string): Record<string, Record<string, unknown>> | null {
  try {
    const parsed = JSON.parse(raw);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return parsed as Record<string, Record<string, unknown>>;
  } catch {
    return null;
  }
}

export function readDecks(raw: string): ApkgDeck[] | null {
  const payload = parseJSONMap(raw);
  if (!payload) return null;
  const out: ApkgDeck[] = [];
  for (const [id, deckRaw] of Object.entries(payload)) {
    const name = stringValue(deckRaw["name"]);
    // Anki encodes nesting in the name ("Parent::Child"); resolve the parent's id by
    // matching the prefix name against the other decks.
    let parentId = "";
    if (name.includes("::")) {
      const parentName = name.slice(0, name.lastIndexOf("::"));
      for (const [otherId, other] of Object.entries(payload)) {
        if (stringValue(other["name"]) === parentName) {
          parentId = otherId;
          break;
        }
      }
    }
    out.push({
      id,
      name: fallback(name, "Imported Deck"),
      parentId: omitEmpty(parentId),
      configId: omitEmpty(numberString(deckRaw["conf"])),
      description: omitEmpty(stringValue(deckRaw["desc"])),
      dynamic: intValue(deckRaw["dyn"]) !== 0,
      mod: omitZero(intValue(deckRaw["mod"])),
      usn: omitZero(intValue(deckRaw["usn"])),
      raw: deckRaw,
    });
  }
  return out;
}

export function readDeckConfigs(raw: string): ApkgDeckConfig[] | null {
  const payload = parseJSONMap(raw);
  if (!payload) return null;
  const out: ApkgDeckConfig[] = Object.entries(payload).map(([id, cfg]) => ({
    id,
    name: fallback(stringValue(cfg["name"]), "Default"),
    raw: cfg,
  }));
  out.sort((a, b) => (byteLess(a.id, b.id) ? -1 : byteLess(b.id, a.id) ? 1 : 0));
  return out;
}

export function readNoteTypes(raw: string): ApkgNoteType[] | null {
  const payload = parseJSONMap(raw);
  if (!payload) return null;
  const out: ApkgNoteType[] = [];
  for (const [id, model] of Object.entries(payload)) {
    const fields: ApkgField[] = [];
    if (Array.isArray(model["flds"])) {
      (model["flds"] as unknown[]).forEach((item, i) => {
        const fieldRaw = (item ?? {}) as Record<string, unknown>;
        fields.push({
          name: fallback(stringValue(fieldRaw["name"]), `Field ${i + 1}`),
          ord: coalesceInt(fieldRaw["ord"], i),
          sticky: omitFalse(boolValue(fieldRaw["sticky"])),
          rtl: omitFalse(boolValue(fieldRaw["rtl"])),
          font: omitEmpty(stringValue(fieldRaw["font"])),
          size: omitZero(intValue(fieldRaw["size"])),
          description: omitEmpty(stringValue(fieldRaw["description"])),
        });
      });
    }
    const templates: ApkgTemplate[] = [];
    if (Array.isArray(model["tmpls"])) {
      (model["tmpls"] as unknown[]).forEach((item, i) => {
        const templateRaw = (item ?? {}) as Record<string, unknown>;
        templates.push({
          name: fallback(stringValue(templateRaw["name"]), `Card ${i + 1}`),
          ord: coalesceInt(templateRaw["ord"], i),
          qfmt: stringValue(templateRaw["qfmt"]),
          afmt: stringValue(templateRaw["afmt"]),
          deckId: omitEmpty(numberString(templateRaw["did"])),
        });
      });
    }
    out.push({
      id,
      name: fallback(stringValue(model["name"]), "Imported Note"),
      type: intValue(model["type"]),
      css: stringValue(model["css"]),
      latexPre: omitEmpty(stringValue(model["latexPre"])),
      latexPost: omitEmpty(stringValue(model["latexPost"])),
      fields,
      templates,
      raw: model,
    });
  }
  return out;
}
