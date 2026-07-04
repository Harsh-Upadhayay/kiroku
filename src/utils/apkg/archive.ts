// ApkgArchive wraps zip.js with the small surface the parser needs. BlobReader gives random
// access into the File — entries decompress on demand, so a 300 MB deck is never buffered
// whole. That random access is also what lets the media-upload pass cheaply re-read just the
// blobs the server turned out to be missing, instead of holding every decoded blob in memory.

import { BlobReader, Uint8ArrayWriter, ZipReader, type FileEntry } from "@zip.js/zip.js";

export class ApkgArchive {
  private constructor(
    private reader: ZipReader<Blob>,
    private entries: Map<string, FileEntry>
  ) {}

  static async open(blob: Blob): Promise<ApkgArchive> {
    const reader = new ZipReader(new BlobReader(blob));
    const list = await reader.getEntries();
    const entries = new Map<string, FileEntry>();
    for (const entry of list) {
      if (!entry.directory) entries.set(entry.filename, entry as FileEntry);
    }
    return new ApkgArchive(reader, entries);
  }

  has(name: string): boolean {
    return this.entries.has(name);
  }

  /** read returns an entry's decompressed (zip-level) bytes, or null when absent. */
  async read(name: string): Promise<Uint8Array | null> {
    const entry = this.entries.get(name);
    if (!entry) return null;
    return entry.getData(new Uint8ArrayWriter());
  }

  async close(): Promise<void> {
    await this.reader.close();
  }
}
