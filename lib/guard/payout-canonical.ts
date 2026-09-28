import { compareCanonicalStrings, hashPayoutRecord, PAYOUT_HASH_DOMAINS } from "./canonical.ts";

/* The payout records' canonical hasher, the decision settlement receipt's hash
   and the store-key encoding live in the kernel's `canonical.ts`: the kernel
   seals receipts and claims transaction hashes with them and does not import
   this module. They are re-exported here unchanged, so every payout module and
   the published verifier read them where they always did; a new receipt
   version or hash domain is added there. */
export {
  PAYOUT_HASH_DOMAINS,
  hashDecisionSettlementReceiptCore,
  hashPayoutRecord,
  payoutStorageKey,
  payoutStorageKeyComponent,
  payoutStoragePrefix,
  type PayoutHashDomain,
} from "./canonical.ts";

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
