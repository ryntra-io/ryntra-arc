import { createHash } from "node:crypto";

import { canonicalJson } from "./canonical-json.ts";

export { compareCanonicalStrings } from "./canonical-json.ts";

/**
 * The server-side digest.
 *
 * Canonicalization moved to `canonical-json.ts` so a browser can perform it
 * without `node:crypto`; the bytes hashed here are the same bytes, produced by
 * the same function. Nothing about the output changed, and the payout golden
 * vectors are what prove that.
 */
export function hashCanonical(value: unknown): string {
  return `0x${createHash("sha256").update(canonicalJson(value)).digest("hex")}`;
}
