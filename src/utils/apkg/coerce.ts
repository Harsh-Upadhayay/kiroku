// Coercion helpers mirroring backend/internal/anki/coerce.go. Values pulled out of the
// collection's JSON metadata are untyped; these convert them exactly the way the Go parser
// does so both implementations emit identical output for the same package.

/** fallback returns value, or fallbackValue when value is blank (Go: coerce.go fallback). */
export function fallback(value: string, fallbackValue: string): string {
  return value.trim() === "" ? fallbackValue : value;
}

export function first(values: string[]): string {
  return values.length === 0 ? "" : values[0];
}

export function secondOrFirst(values: string[]): string {
  return values.length > 1 ? values[1] : first(values);
}

/** splitTags splits Anki's space-delimited tag string (Go: strings.Fields). */
export function splitTags(input: string): string[] {
  return input.split(/\s+/).filter(Boolean);
}

/**
 * stringValue renders a JSON value as a string the way Go's fmt.Sprintf("%v") does for the
 * values that actually occur in Anki metadata (strings, numbers, booleans, null).
 */
export function stringValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value);
}

/** intValue coerces a JSON value to an integer, truncating toward zero (Go: int64(float64)). */
export function intValue(value: unknown): number {
  if (typeof value === "number") return Math.trunc(value);
  if (typeof value === "string") {
    const n = parseInt(value, 10);
    return Number.isNaN(n) ? 0 : n;
  }
  return 0;
}

/** coalesceInt returns fallbackValue when value is null/undefined, otherwise the coerced int. */
export function coalesceInt(value: unknown, fallbackValue: number): number {
  return value === null || value === undefined ? fallbackValue : intValue(value);
}

export function boolValue(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") return value === "true" || value === "1";
  return false;
}

/** numberString renders a numeric value as a string, treating zero as empty ("unset" ids). */
export function numberString(value: unknown): string {
  const n = intValue(value);
  return n === 0 ? "" : String(n);
}

/** zeroEmpty renders an int as a string, or "" when it is zero. */
export function zeroEmpty(value: number): string {
  return value === 0 ? "" : String(value);
}

// The omit* helpers implement Go's `omitempty`: the parser sets optional fields through
// these so a zero value becomes `undefined` (dropped by JSON.stringify) instead of being
// serialized — keeping the output byte-compatible with the Go parser's marshaling.

export function omitZero(n: number): number | undefined {
  return n === 0 ? undefined : n;
}

export function omitEmpty(s: string): string | undefined {
  return s === "" ? undefined : s;
}

export function omitFalse(b: boolean): true | undefined {
  return b ? true : undefined;
}
