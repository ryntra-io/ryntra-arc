import { createHash } from "node:crypto";

import { compareCanonicalStrings, hashCanonical } from "./canonical.ts";

/**
 * Canonical, domain-separated hashing for the Arc Treasury Payout records.
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
  /* A payment a team received through its request (Arc 11). The team decided
     and approved nothing about the transfer, so the record says what was
     received and rests on the payer's own receipt — and its domain keeps it
     from ever being read as the operation that paid it. */
  receivedPaymentReceipt: "ryntra:received-payment-receipt:1.6.0",
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

/* ------------------------------------------------------------------ *
 * Normalization
 * ------------------------------------------------------------------ */

const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const HEX_HASH = /^0x[0-9a-fA-F]{64}$/;

/** ERC-20 USDC on Arc uses 6 decimals; the native interface uses 18. */
export const USDC_ERC20_DECIMALS = 6;
export const ARC_NATIVE_DECIMALS = 18;

/**
 * The largest payout this contract will represent: 10^18 − 1 base units, i.e.
 * 999,999,999,999.999999 USDC.
 *
 * A bound has to exist and has to be stated. Without one, "the maximum
 * supported amount" is whatever the first overflow happens to be, which is not
 * a contract anybody can test against.
 */
export const MAX_PAYOUT_BASE_UNITS = 10n ** 18n - 1n;

/**
 * Lowercase hex address.
 *
 * Checksum casing is deliberately *not* preserved. EIP-55 casing carries no
 * information the raw address does not, and preserving it would let the same
 * beneficiary produce two different version hashes depending on how the
 * operator pasted it.
 */
export function normalizePayoutAddress(value: string): string {
  if (!EVM_ADDRESS.test(value)) throw new TypeError("Payout address must be a 20-byte hex EVM address.");
  return value.toLowerCase();
}

export function normalizePayoutHash(value: string): string {
  if (!HEX_HASH.test(value)) throw new TypeError("Payout hash must be a 32-byte hex digest.");
  return value.toLowerCase();
}

/**
 * RFC3339 UTC with milliseconds.
 *
 * Two records describing the same instant must hash the same, so an offset
 * timestamp is converted rather than rejected — but an unparseable one is
 * rejected, because a hash over `Invalid Date` is a hash over nothing.
 */
export function normalizePayoutTimestamp(value: string): string {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new TypeError("Payout timestamp must be a parseable RFC3339 instant.");
  return new Date(parsed).toISOString();
}

const PLAIN_DECIMAL = /^(0|[1-9]\d*)(?:\.(\d+))?$/;

/**
 * Parse a plain decimal USDC amount into integer 6-decimal base units.
 *
 * Rejected, each for its own reason:
 * - scientific notation (`1e6`) — one amount would have several spellings;
 * - a leading `+`/`-` — a payout is never negative and never signed;
 * - more than six fractional digits — excess precision is silently truncated by
 *   every naive implementation, and truncated money is a defect, not a rounding
 *   preference;
 * - leading zeros (`01.5`) — same value, different bytes;
 * - a bare trailing dot (`1.`) — ambiguous.
 */
export function payoutBaseUnitsFromDecimal(amount: string): bigint {
  if (typeof amount !== "string" || amount.length === 0 || amount.length > 40) {
    throw new TypeError("Payout amount must be a bounded decimal string.");
  }
  const match = PLAIN_DECIMAL.exec(amount);
  if (!match) throw new TypeError("Payout amount must be a plain decimal string without sign or exponent.");
  const fraction = match[2] ?? "";
  if (fraction.length > USDC_ERC20_DECIMALS) {
    throw new TypeError("Payout amount carries more precision than ERC-20 USDC represents.");
  }
  const padded = fraction.padEnd(USDC_ERC20_DECIMALS, "0");
  const units = BigInt(match[1]) * 10n ** BigInt(USDC_ERC20_DECIMALS) + BigInt(padded || "0");
  if (units > MAX_PAYOUT_BASE_UNITS) throw new RangeError("Payout amount exceeds the supported maximum.");
  return units;
}

/** Canonical decimal spelling of an integer base-unit amount: always 6 places. */
export function payoutDecimalFromBaseUnits(units: bigint): string {
  if (units < 0n) throw new RangeError("Payout base units cannot be negative.");
  if (units > MAX_PAYOUT_BASE_UNITS) throw new RangeError("Payout base units exceed the supported maximum.");
  const scale = 10n ** BigInt(USDC_ERC20_DECIMALS);
  return `${units / scale}.${(units % scale).toString().padStart(USDC_ERC20_DECIMALS, "0")}`;
}

/** Integer base-unit string as it appears inside a hashed record. */
export function payoutBaseUnitsString(units: bigint): string {
  if (units < 0n) throw new RangeError("Payout base units cannot be negative.");
  return units.toString(10);
}

export function parsePayoutBaseUnits(value: string): bigint {
  if (!/^(0|[1-9]\d*)$/.test(value)) throw new TypeError("Base units must be a plain non-negative integer string.");
  const units = BigInt(value);
  if (units > MAX_PAYOUT_BASE_UNITS) throw new RangeError("Base units exceed the supported maximum.");
  return units;
}

/**
 * Convert a raw native 18-decimal fee ceiling into 6-decimal economic units,
 * **rounding up**.
 *
 * Arc exposes one USDC balance through two interfaces — native 18 decimals for
 * gas and `msg.value`, ERC-20 6 decimals for transfers — so a fee quoted in
 * native units debits the same balance the transfer does. Policy therefore has
 * to reserve against both in one currency.
 *
 * The direction of the rounding is the whole point. A fee of 1 native wei is
 * economically below 0.000001 USDC; truncating it to 0 lets a payout reserve
 * less than it can actually spend, and a daily limit that under-reserves is a
 * limit that can be crossed. Rounding up can only over-reserve, which fails
 * closed.
 */
export function conservativeFeeBaseUnitsFromNative(nativeUnits: bigint): bigint {
  if (nativeUnits < 0n) throw new RangeError("A native fee ceiling cannot be negative.");
  const divisor = 10n ** BigInt(ARC_NATIVE_DECIMALS - USDC_ERC20_DECIMALS);
  const units = (nativeUnits + divisor - 1n) / divisor;
  if (units > MAX_PAYOUT_BASE_UNITS) throw new RangeError("Normalized fee exceeds the supported maximum.");
  return units;
}

export function parseNativeFeeUnits(value: string): bigint {
  if (!/^(0|[1-9]\d*)$/.test(value)) {
    throw new TypeError("A native fee ceiling must be a plain non-negative integer string.");
  }
  if (value.length > 40) throw new RangeError("Native fee ceiling is out of range.");
  return BigInt(value);
}

/** The UTC calendar day a payout is accounted against: `YYYY-MM-DD`. */
export function payoutUtcDayKey(instant: string): string {
  return normalizePayoutTimestamp(instant).slice(0, 10);
}

/* ------------------------------------------------------------------ *
 * Approval sets
 * ------------------------------------------------------------------ */

export type PayoutApprovalSetMember = {
  principalRef: string;
  approvalHash: string;
};

/**
 * Hash a set of approvals in a deterministic order.
 *
 * Insertion order is not usable here: two Guard instances can record the same
 * two approvals in either order, and an authorization bound to an
 * order-dependent hash would then reject a perfectly valid second approver.
 * Members are sorted by `principalRef`, then by `approvalHash` for the case
 * where one principal legitimately holds two distinct approval records.
 *
 * A repeated `principalRef` is rejected rather than deduplicated. Two approvals
 * from one principal must never be able to satisfy a two-approver threshold,
 * and silently collapsing them here would hide exactly that.
 */
export function payoutApprovalSetHash(members: readonly PayoutApprovalSetMember[]): string {
  if (members.length === 0) throw new TypeError("An approval set must contain at least one approval.");
  if (members.length > 16) throw new RangeError("An approval set is bounded to sixteen members.");
  const seenPrincipals = new Set<string>();
  const seenApprovals = new Set<string>();
  for (const member of members) {
    if (seenPrincipals.has(member.principalRef)) {
      throw new TypeError("An approval set cannot contain the same principal twice.");
    }
    if (seenApprovals.has(member.approvalHash)) {
      throw new TypeError("An approval set cannot contain the same approval twice.");
    }
    seenPrincipals.add(member.principalRef);
    seenApprovals.add(member.approvalHash);
  }
  const ordered = [...members]
    .map((member) => ({
      principalRef: member.principalRef,
      approvalHash: normalizePayoutHash(member.approvalHash),
    }))
    .sort(
      (left, right) =>
        compareCanonicalStrings(left.principalRef, right.principalRef) ||
        compareCanonicalStrings(left.approvalHash, right.approvalHash),
    );
  return hashPayoutRecord(PAYOUT_HASH_DOMAINS.approvalSet, { members: ordered });
}
