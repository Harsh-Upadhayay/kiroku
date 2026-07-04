// The data model produced by the client-side .apkg parser. It deliberately mirrors
// backend/internal/anki/types.go field for field — the JSON emitted here must be
// indistinguishable from the Go parser's output, and the parity test in
// src/tests/apkg-parse.test.ts holds both to the same committed goldens.
//
// Optional fields correspond exactly to Go's `omitempty` tags: the parser leaves them
// undefined (never 0/""/false) so a JSON.stringify of the result matches Go's marshaling.

export interface ApkgDeck {
  id: string;
  name: string;
  parentId?: string;
  configId?: string;
  description?: string;
  dynamic: boolean;
  mod?: number;
  usn?: number;
  raw?: Record<string, unknown>;
}

export interface ApkgDeckConfig {
  id: string;
  name: string;
  raw: Record<string, unknown> | null;
}

export interface ApkgField {
  name: string;
  ord: number;
  sticky?: boolean;
  rtl?: boolean;
  font?: string;
  size?: number;
  description?: string;
}

export interface ApkgTemplate {
  name: string;
  ord: number;
  qfmt: string;
  afmt: string;
  deckId?: string;
}

export interface ApkgNoteType {
  id: string;
  name: string;
  type: number;
  css: string;
  latexPre?: string;
  latexPost?: string;
  fields: ApkgField[];
  templates: ApkgTemplate[];
  raw?: Record<string, unknown>;
}

export interface ApkgNote {
  id: string;
  guid: string;
  noteTypeId: string;
  sortField?: string;
  tags: string[];
  fields: Record<string, string>;
  fieldOrder: string[];
  rawFields: string[];
  mod?: number;
  usn?: number;
}

export interface ApkgCard {
  id: string;
  noteId: string;
  deckId: string;
  ord: number;
  type: number;
  queue: number;
  due: number;
  interval: number;
  factor: number;
  reps: number;
  lapses: number;
  left?: number;
  originalDeckId?: string;
  flags?: number;
  data?: string;
  templateName?: string;
  front: string;
  back: string;
  raw?: Record<string, unknown>;
}

export interface ApkgReviewLog {
  id: string;
  cardId: string;
  usn: number;
  ease: number;
  interval: number;
  lastInterval: number;
  factor: number;
  time: number;
  type: number;
}

export interface ApkgMediaRef {
  hash: string;
  fileName: string;
  entryName: string;
  contentType: string;
  bytes: number;
}

export interface ApkgCollection {
  id: string;
  name: string;
  createdAt: number;
  decks: ApkgDeck[] | null;
  deckConfigs: ApkgDeckConfig[] | null;
  noteTypes: ApkgNoteType[] | null;
  notes: ApkgNote[];
  cards: ApkgCard[];
  reviewLogs: ApkgReviewLog[];
}

export interface ApkgImportReport {
  packageKind: string;
  warnings: string[];
  decks: number;
  deckConfigs: number;
  noteTypes: number;
  notes: number;
  cards: number;
  reviewLogs: number;
  mediaFiles: number;
}

export interface ApkgImportResult {
  importId: string;
  collection: ApkgCollection;
  mediaManifest: ApkgMediaRef[] | null;
  report: ApkgImportReport;
}
