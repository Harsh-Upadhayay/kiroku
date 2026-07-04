// Minimal protobuf reader for the MediaEntries manifest in ".anki21b" packages, mirroring
// the hand-rolled decoder in backend/internal/anki/media.go. The message shape is:
//
//	message MediaEntries { repeated MediaEntry entries = 1; }
//	message MediaEntry  { string name = 1; uint32 size = 2; bytes sha1 = 3; }
//
// Only each entry's name is needed — the Nth entry's blob is the zip file named "N" — so a
// ~hundred-line reader beats pulling a protobuf runtime into the bundle for one message.

/** readVarint decodes a varint at offset, returning [value, next offset]. */
function readVarint(b: Uint8Array, at: number): [number, number] {
  let value = 0;
  let shift = 0;
  let offset = at;
  for (;;) {
    if (offset >= b.length || shift > 53) throw new Error("malformed protobuf varint");
    const byte = b[offset++];
    value += (byte & 0x7f) * 2 ** shift;
    if ((byte & 0x80) === 0) return [value, offset];
    shift += 7;
  }
}

/** readBytes reads a length-delimited (wire type 2) value at offset. */
function readBytes(b: Uint8Array, at: number): [Uint8Array, number] {
  const [length, start] = readVarint(b, at);
  const end = start + length;
  if (end > b.length) throw new Error("malformed protobuf length-delimited field");
  return [b.subarray(start, end), end];
}

/** skipField advances past a field's value by wire type. */
function skipField(b: Uint8Array, at: number, wireType: number): number {
  switch (wireType) {
    case 0:
      return readVarint(b, at)[1];
    case 1:
      if (at + 8 > b.length) throw new Error("truncated protobuf 64-bit field");
      return at + 8;
    case 2:
      return readBytes(b, at)[1];
    case 5:
      if (at + 4 > b.length) throw new Error("truncated protobuf 32-bit field");
      return at + 4;
    default:
      throw new Error(`unsupported protobuf wire type ${wireType}`);
  }
}

/** readEntryName extracts field 1 (name) from a single MediaEntry message. */
function readEntryName(msg: Uint8Array): string {
  let at = 0;
  while (at < msg.length) {
    const [tag, next] = readVarint(msg, at);
    const fieldNum = Math.floor(tag / 8);
    const wireType = tag & 0x7;
    at = next;
    if (fieldNum === 1 && wireType === 2) {
      const [value] = readBytes(msg, at);
      return new TextDecoder().decode(value);
    }
    at = skipField(msg, at, wireType);
  }
  return "";
}

/**
 * parseMediaEntriesProto decodes a MediaEntries message into ordered file names; the index
 * of each name is its zip entry name.
 */
export function parseMediaEntriesProto(raw: Uint8Array): string[] {
  const names: string[] = [];
  let at = 0;
  while (at < raw.length) {
    const [tag, next] = readVarint(raw, at);
    const fieldNum = Math.floor(tag / 8);
    const wireType = tag & 0x7;
    at = next;
    if (fieldNum === 1 && wireType === 2) {
      const [msg, rest] = readBytes(raw, at);
      names.push(readEntryName(msg));
      at = rest;
      continue;
    }
    at = skipField(raw, at, wireType);
  }
  return names;
}
