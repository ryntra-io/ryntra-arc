/**
 * The receipt's canonical serialization and its two seals.
 *
 * Nothing here is written a second time. These are the functions the Ryntra
 * product seals its receipts with, imported from the modules it runs on:
 * `lib/guard/canonical-json.ts` is the one canonicalizer, `lib/guard/canonical.ts`
 * digests its output, and `lib/guard/payout-canonical.ts` picks the hash
 * contract a receipt's schema version was sealed under. A verifier with its
 * own copy of the encoding would be checking its copy, not the receipt.
 *
 * ## The encoding
 *
 * `canonicalJson(value)` is `JSON.stringify` over the value with object keys
 * in ascending UTF-16 code-unit order at every depth, `undefined` members
 * dropped, `null` kept, arrays in their given order and every number finite.
 *
 * A receipt carries two SHA-256 seals, both lowercase hex with a `0x` prefix:
 *
 * ```text
 * core           = the receipt without `receiptHash` and `integrity`
 * receiptHash    = sha256(canonicalJson(core))                    1.0.0, 1.1.0
 *                = sha256(domain + "\n" + canonicalJson(core))     1.2.0 and later
 * integrity.hash = sha256(canonicalJson({ ...core, receiptHash }))
 * ```
 *
 * The domain names the kind of record, so a payout, a swap and a crosschain
 * receipt can never be presented as one another: see {@link RECEIPT_HASH_DOMAINS}.
 * An unknown schema version is refused rather than hashed under a guess.
 */

export { canonicalJson, canonicalize, compareCanonicalStrings } from "../../../lib/guard/canonical-json.ts";
export type { JsonValue } from "../../../lib/guard/canonical-json.ts";
export { hashCanonical } from "../../../lib/guard/canonical.ts";
export {
  PAYOUT_HASH_DOMAINS as RECEIPT_HASH_DOMAINS,
  hashDecisionSettlementReceiptCore as hashReceiptCore,
} from "../../../lib/guard/payout-canonical.ts";
