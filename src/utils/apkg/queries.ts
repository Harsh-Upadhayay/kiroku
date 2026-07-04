// notes/cards/revlog table readers, mirroring backend/internal/anki/queries.go. Row order is
// whatever SQLite returns for an unordered SELECT — both implementations scan the same file,
// so they see the same order.

import type { Database } from "sql.js";
import type { ApkgCard, ApkgNote, ApkgNoteType, ApkgReviewLog } from "./types";
import { omitEmpty, omitZero, splitTags, zeroEmpty } from "./coerce";
import { previewFrontBack } from "./template";

/** fieldSeparator is the ASCII "unit separator" Anki joins a note's field values with. */
const fieldSeparator = "\x1f";

/** str/int coerce SQLite column values the way Go's Scan into string/int64 does. */
function str(v: unknown): string {
  return v === null || v === undefined ? "" : String(v);
}

function int(v: unknown): number {
  return typeof v === "number" ? v : v === null || v === undefined ? 0 : Number(v);
}

/** eachRow runs stmt to completion, freeing it even when a row callback throws. */
function eachRow(db: Database, sql: string, onRow: (row: unknown[]) => void): void {
  const stmt = db.prepare(sql);
  try {
    while (stmt.step()) onRow(stmt.get());
  } finally {
    stmt.free();
  }
}

/**
 * readNotes reads the notes table, splitting each note's separator-joined field string and
 * pairing values with field names from its model ("Field N" when the model is unknown or has
 * fewer fields). Returns the notes plus a by-id lookup used when building cards.
 */
export function readNotes(db: Database, noteTypes: ApkgNoteType[]): [ApkgNote[], Map<string, ApkgNote>] {
  const modelById = new Map(noteTypes.map((m) => [m.id, m]));
  const notes: ApkgNote[] = [];
  const byId = new Map<string, ApkgNote>();
  eachRow(db, "SELECT id, guid, mid, mod, usn, tags, flds, sfld FROM notes", (row) => {
    const [id, guid, mid, mod, usn, tags, flds, sfld] = row;
    const rawFields = str(flds).split(fieldSeparator);
    const model = modelById.get(str(mid));
    const fieldOrder: string[] = [];
    const fields: Record<string, string> = {};
    rawFields.forEach((value, i) => {
      const name = model && i < model.fields.length ? model.fields[i].name : `Field ${i + 1}`;
      fieldOrder.push(name);
      fields[name] = value;
    });
    const note: ApkgNote = {
      id: str(id),
      guid: str(guid),
      noteTypeId: str(mid),
      sortField: omitEmpty(str(sfld)),
      tags: splitTags(str(tags)),
      fields,
      fieldOrder,
      rawFields,
      mod: omitZero(int(mod)),
      usn: omitZero(int(usn)),
    };
    notes.push(note);
    byId.set(note.id, note);
  });
  return [notes, byId];
}

/** readCards reads the cards table, rendering a plain-text front/back preview per card. */
export function readCards(db: Database, noteTypes: ApkgNoteType[], notes: Map<string, ApkgNote>): ApkgCard[] {
  const modelById = new Map(noteTypes.map((m) => [m.id, m]));
  const cards: ApkgCard[] = [];
  eachRow(
    db,
    "SELECT id, nid, did, ord, mod, usn, type, queue, due, ivl, factor, reps, lapses, left, odid, flags, data FROM cards",
    (row) => {
      const [id, nid, did, ord, mod, usn, typ, queue, due, ivl, factor, reps, lapses, left, odid, flags, data] = row;
      const note = notes.get(str(nid)) ?? {
        id: "", guid: "", noteTypeId: "", tags: [], fields: {}, fieldOrder: [], rawFields: [],
      };
      const model = modelById.get(note.noteTypeId);
      const ordNum = int(ord);
      const templates = model?.templates ?? [];
      const templateName = ordNum >= 0 && ordNum < templates.length ? templates[ordNum].name : "";
      const [front, back] = previewFrontBack(note, model, ordNum);
      cards.push({
        id: str(id),
        noteId: str(nid),
        deckId: str(did),
        ord: ordNum,
        type: int(typ),
        queue: int(queue),
        due: int(due),
        interval: int(ivl),
        factor: int(factor),
        reps: int(reps),
        lapses: int(lapses),
        left: omitZero(int(left)),
        originalDeckId: omitEmpty(zeroEmpty(int(odid))),
        flags: omitZero(int(flags)),
        data: omitEmpty(str(data)),
        templateName: omitEmpty(templateName),
        front,
        back,
        raw: { mod: int(mod), usn: int(usn) },
      });
    }
  );
  return cards;
}

/** readReviewLogs reads the revlog table; callers treat a throw as a warning (Go parity). */
export function readReviewLogs(db: Database): ApkgReviewLog[] {
  const out: ApkgReviewLog[] = [];
  eachRow(db, "SELECT id, cid, usn, ease, ivl, lastIvl, factor, time, type FROM revlog", (row) => {
    const [id, cid, usn, ease, ivl, lastIvl, factor, time, typ] = row;
    out.push({
      id: str(id),
      cardId: str(cid),
      usn: int(usn),
      ease: int(ease),
      interval: int(ivl),
      lastInterval: int(lastIvl),
      factor: int(factor),
      time: int(time),
      type: int(typ),
    });
  });
  return out;
}
