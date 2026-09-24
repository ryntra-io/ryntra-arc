/**
 * Canonical JSON, with no digest and no platform.
 *
 * Split out of `canonical.ts` for one reason: `canonical.ts` imports
 * `node:crypto`, and a hash that only exists on a server cannot be recomputed by
 * the person holding the receipt. A receipt may be finalized in a browser,
 * where `createHash` does not exist and Web Crypto does — but Web Crypto is
 * asynchronous, so the two digests are necessarily written twice.
 *
 * **Two hashers over one canonicalizer is safe; two canonicalizers is not.** The
 * digest is SHA-256 either way and cannot drift. What can drift is key order,
 * `undefined` handling, or number rules — so that lives here, once, and both
 * sides import it. A test asserts the two hashers
 * produce identical hex for the same value, which is what makes "recompute it
 * yourself" a checkable claim rather than a promise.
 */

type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

/** Locale-independent UTF-16 code-unit order for hashes and lock acquisition. */
export function compareCanonicalStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function canonicalize(value: unknown): JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("Non-finite number is not canonical JSON.");
    return value;
  }
  if (Array.isArray(value)) return value.map(canonicalize);
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, entry]) => entry !== undefined)
        .sort(([left], [right]) => compareCanonicalStrings(left, right))
        .map(([key, entry]) => [key, canonicalize(entry)]),
    );
  }
  throw new TypeError("Value is not canonical JSON.");
}

/** The exact bytes both hashers digest. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}
