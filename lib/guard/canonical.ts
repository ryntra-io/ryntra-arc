import { createHash } from "node:crypto";

import { canonicalJson, compareCanonicalStrings } from "./canonical-json.ts";

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

/* The domain-separated record hasher, the decision settlement receipt's hash
   and the store-key encoding below moved here, byte for byte, from
   `payout-canonical.ts`. The kernel seals every receipt and claims every
   transaction hash with them, and the kernel does not import the payout
   modules; `payout-canonical.ts` re-exports all of it, so each payout module
   reads it exactly where it always did. */

/**
 * Canonical, domain-separated hashing for the treasury payout records.
 *
 * This is deliberately a *second* helper rather than a change to
 * `hashCanonical`. The existing helper hashes `JSON.stringify(canonical(value))`
 * with no domain prefix, and every intent, authorization, execution and receipt
 * vector in the repository is pinned to those exact bytes. Adding a prefix there
 * would silently rewrite all of them, so the payout records get their own
 * function and the legacy bytes stay untouched — the compatibility rule this
 * task is built on.
 *
 * ## Exact encoding
 *
 * ```text
 * hash = "0x" + hex( SHA-256( UTF-8( domain + "\n" + canonicalJson(payload) ) ) )
 * ```
 *
 * - **Domain** is one of {@link PAYOUT_HASH_DOMAINS}, terminated by a single
 *   `\n`. The separator is a byte that cannot appear in a domain label, so no
 *   two distinct (domain, payload) pairs can collide by concatenation.
 * - **Key ordering** is ascending UTF-16 code-unit order at every object depth,
 *   using the same comparator the legacy helper uses, so two implementations of
 *   the same record cannot disagree because of locale.
 * - **`undefined` members are dropped; `null` is preserved.** A field that is
 *   explicitly "no value" is part of the record; a field nobody set is not.
 * - **Arrays keep their given order.** Callers that need order independence
 *   sort before hashing — {@link payoutApprovalSetHash} is the one place that
 *   matters, and it sorts explicitly rather than trusting insertion order.
 * - **Numbers must be finite.** Money never travels as a JavaScript number in
 *   these records; it travels as a decimal string plus an integer base-unit
 *   string, both normalized before hashing.
 * - **Output** is lowercase hex with a `0x` prefix.
 */
export const PAYOUT_HASH_DOMAINS = {
  instruction: "ryntra:payout-instruction:1.0.0",
  beneficiary: "ryntra:payout-beneficiary:1.0.0",
  policy: "ryntra:payout-policy:1.0.0",
  approval: "ryntra:payout-approval:1.0.0",
  approvalSet: "ryntra:payout-approval-set:1.0.0",
  fingerprint: "ryntra:payout-fingerprint:1.0.0",
  receipt: "ryntra:payout-receipt:1.2.0",
  arcVerification: "ryntra:payout-arc-verification:1.0.0",
  /* A swap receipt is not a payout, and its hash says so. Sharing the payout
     domain would mean two different records could, in principle, be presented
     as each other; a separate label costs one string and makes that
     unrepresentable. The helper below is in this file for the same reason the
     payout domain is: there is exactly one canonical hasher in this
     repository, and a second one is how two implementations of the same record
     start disagreeing. */
  swapReceipt: "ryntra:swap-receipt:1.3.0",
  /* A swap whose debit spans two currencies is a different record from one
     whose debit is a single number, and it gets its own label rather than a
     new optional member inside the old one. A verifier that only knows 1.3.0
     must not be able to hash a 1.5.0 core and get an answer that looks
     valid. */
  splitCurrencySwapReceipt: "ryntra:swap-receipt:1.5.0",
  /* And a bridge receipt is neither. It records a burn on one chain and a
     mint on another, so it is the one record in this family whose evidence
     comes from two ledgers; giving it either of the domains above would let
     a single-chain record be presented as a crosschain one. */
  bridgeReceipt: "ryntra:bridge-receipt:1.4.0",
  /* A payment a team received through its request (the hub's team sign-in). The team decided
     and approved nothing about the transfer, so the record says what was
     received and rests on the payer's own receipt — and its domain keeps it
     from ever being read as the operation that paid it. */
  receivedPaymentReceipt: "ryntra:received-payment-receipt:1.6.0",
  /* A transfer into or out of the hub's network through Circle's CCTP: a burn on
     one network, Circle's attestation and a mint on another, each read from
     its own ledger. 1.4.0 recorded a planned bridge on the testnet with one
     side possibly unread; this record exists only when both sides were read,
     names both chains, and is sealed under its own label so neither can be
     presented as the other. */
  bridgeTransferReceipt: "ryntra:bridge-transfer-receipt:1.7.0",
  /* A route across networks on any rail the hub's bridge offers — Relay,
     Across, or Circle's bridge with the integrator's fee: both sides
     read, the quote at signing, and the integrator's fee as its own line. Its
     own label, so a CCTP transfer receipt (1.7.0) and a route receipt can
     never be presented as each other. */
  bridgeRouteReceipt: "ryntra:bridge-route-receipt:1.8.0",
  /* A swap on one network through an aggregator's router, with the integrator's
     fee paid in the same transaction: what was paid and what arrived, the
     quote at signing, and the fee as its own line. Its own label, so a
     testnet swap receipt (1.3.0, 1.5.0) and this one can never be presented
     as each other. */
  swapRouteReceipt: "ryntra:swap-route-receipt:1.9.0",
} as const;

export type PayoutHashDomain = (typeof PAYOUT_HASH_DOMAINS)[keyof typeof PAYOUT_HASH_DOMAINS];

type JsonPrimitive = string | number | boolean | null;
type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

function canonicalize(value: unknown): JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("Non-finite number is not canonical payout JSON.");
    return value;
  }
  if (typeof value === "bigint") {
    /* A bigint would stringify unpredictably across runtimes. Base units are
       carried as decimal strings precisely so the hash cannot depend on that. */
    throw new TypeError("Encode payout integers as base-unit strings before hashing.");
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
  throw new TypeError("Value is not canonical payout JSON.");
}

export function hashPayoutRecord(domain: PayoutHashDomain, payload: unknown): string {
  const body = `${domain}\n${JSON.stringify(canonicalize(payload))}`;
  return `0x${createHash("sha256").update(body, "utf8").digest("hex")}`;
}

/**
 * Preserve the issued v1.0/v1.1 receipt bytes while moving payout receipts into
 * their own namespace. Unknown versions fail closed instead of silently
 * inheriting either hash contract.
 */
export function hashDecisionSettlementReceiptCore(core: unknown): string {
  if (typeof core !== "object" || core === null || Array.isArray(core)) {
    throw new TypeError("Decision settlement receipt core must be an object with a schema version.");
  }
  const schemaVersion = (core as { schemaVersion?: unknown }).schemaVersion;
  if (schemaVersion === "1.0.0" || schemaVersion === "1.1.0") return hashCanonical(core);
  if (schemaVersion === "1.2.0") return hashPayoutRecord(PAYOUT_HASH_DOMAINS.receipt, core);
  if (schemaVersion === "1.3.0") return hashPayoutRecord(PAYOUT_HASH_DOMAINS.swapReceipt, core);
  if (schemaVersion === "1.5.0") {
    return hashPayoutRecord(PAYOUT_HASH_DOMAINS.splitCurrencySwapReceipt, core);
  }
  if (schemaVersion === "1.4.0") return hashPayoutRecord(PAYOUT_HASH_DOMAINS.bridgeReceipt, core);
  if (schemaVersion === "1.6.0") return hashPayoutRecord(PAYOUT_HASH_DOMAINS.receivedPaymentReceipt, core);
  if (schemaVersion === "1.7.0") return hashPayoutRecord(PAYOUT_HASH_DOMAINS.bridgeTransferReceipt, core);
  if (schemaVersion === "1.8.0") return hashPayoutRecord(PAYOUT_HASH_DOMAINS.bridgeRouteReceipt, core);
  if (schemaVersion === "1.9.0") return hashPayoutRecord(PAYOUT_HASH_DOMAINS.swapRouteReceipt, core);
  throw new TypeError("Unsupported decision settlement receipt schema version.");
}

/**
 * Encode one untrusted identifier as a collision-free store-key component.
 *
 * Payout identifiers intentionally permit `.` and `:` for partner naming. Raw
 * delimiter concatenation therefore cannot be a tenancy boundary: `foo` plus
 * `bar:baz` collides with `foo:bar` plus `baz`, and a `foo:` prefix also scans
 * tenant `foo:bar`. URI component encoding is deterministic UTF-8, escapes the
 * delimiter and `%`, and remains readable enough for operator diagnostics.
 */
export function payoutStorageKeyComponent(value: string): string {
  return encodeURIComponent(value);
}

export function payoutStorageKey(kind: string, ...components: readonly string[]): string {
  return [kind, ...components.map(payoutStorageKeyComponent)].join(":");
}

export function payoutStoragePrefix(kind: string, ...components: readonly string[]): string {
  return `${payoutStorageKey(kind, ...components)}:`;
}
