/**
 * A settlement receipt as a document: the references it answers to, the chain
 * it names, its two seals recomputed, and the projection a stranger may see.
 *
 * The Ryntra receipt verifier route (`/api/arc-verify`) imports these
 * functions, and this package's command line reads that verifier's answer
 * with the same types — one definition of what a receipt says, on both sides
 * of the wire.
 *
 * The schema is `schema/receipt.schema.json` (JSON Schema 2020-12), generated
 * from the product's own receipt schema. Every function here is total over
 * untrusted JSON: a member of the wrong type is read as absent, never trusted
 * because a type declaration said so.
 */

import { hashCanonical, hashReceiptCore } from "./canonical.ts";
import { publicReceiptDetail } from "../../../lib/arc/receipt-kinds.ts";

export { RECEIPT_KINDS, publicReceiptDetail, receiptKind, receiptPrivateValues } from "../../../lib/arc/receipt-kinds.ts";
export type {
  PublicBridgeDetail,
  PublicPayoutDetail,
  PublicReceiptDetail,
  PublicSwapDetail,
  ReceiptKind,
} from "../../../lib/arc/receipt-kinds.ts";

export type Json = Record<string, unknown>;

/** Every schema version a receipt may carry; each has its own hash contract. */
export const RECEIPT_SCHEMA_VERSIONS = ["1.0.0", "1.1.0", "1.2.0", "1.3.0", "1.4.0", "1.5.0", "1.6.0", "1.7.0", "1.8.0", "1.9.0"] as const;

/** `int_…`, `rcpt_…`, `rcp_…` and any other `prefix_hex` identifier the product mints. */
const RECORD_REF = /^[a-z][a-z0-9-]{1,23}_[0-9a-f]{16,64}$/;
const HASH_REF = /^0x[0-9a-f]{64}$/;
const MAX_REF_LENGTH = 128;

export function object(value: unknown): Json | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Json) : null;
}

export function text(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

export function lowerHash(value: unknown): string | null {
  const raw = text(value);
  return raw && HASH_REF.test(raw.toLowerCase()) ? raw.toLowerCase() : null;
}

/**
 * A reference as a person pastes it, normalized — or null when it cannot be a
 * receipt reference at all. A receipt answers to its own id, its operation id,
 * either of its seals and its transaction hash.
 */
export function normalizeReceiptReference(raw: string | null | undefined): string | null {
  const ref = (raw ?? "").trim().toLowerCase();
  if (!ref || ref.length > MAX_REF_LENGTH) return null;
  return RECORD_REF.test(ref) || HASH_REF.test(ref) ? ref : null;
}

/**
 * Every reference this record answers to. A transfer across networks (1.7.0)
 * also answers to its burn and its delivery — the two transactions a person
 * holds — each on its own chain; so does a route (1.8.0).
 */
export function referencesOf(record: Json): string[] {
  const execution = object(record.execution);
  const intent = object(record.intent);
  const integrity = object(record.integrity);
  const bridge = record.schemaVersion === "1.7.0" ? object(record.bridge) : null;
  /* A route across networks (1.8.0) answers to both its transactions too — the
     ones on EVM networks, which is what a pasted hash can be. */
  const route = record.schemaVersion === "1.8.0" ? object(record.route) : null;
  const references = [
    text(record.id),
    text(intent?.id),
    lowerHash(record.receiptHash),
    lowerHash(integrity?.hash),
    lowerHash(execution?.transactionHash),
    lowerHash(object(bridge?.source)?.transactionHash),
    lowerHash(object(bridge?.destination)?.transactionHash),
    lowerHash(object(route?.source)?.transactionHash),
    lowerHash(object(route?.destination)?.transactionHash),
  ].filter((value): value is string => value !== null);
  return [...new Set(references)];
}

/**
 * The chain this receipt settled on, read from the receipt itself.
 *
 * A payout receipt states it. Other receipts carry no `chainRef` member, but
 * their reconciliation evidence records `${chainRef}:tx:${hash}` as the source
 * it was observed at, so the chain is recoverable from provenance rather than
 * assumed from whichever network a reader happens to use. When neither is
 * readable the answer is `null` — never "Arc".
 */
export function chainRefOf(record: Json): string | null {
  const payoutChain = object(object(record.payout)?.chain);
  const declared = text(payoutChain?.chainRef) ?? text(object(record.received)?.chainRef);
  if (declared) return declared;
  const sourceRef = text(object(object(record.reconciliation)?.evidence)?.sourceRef);
  if (!sourceRef) return null;
  const marker = sourceRef.indexOf(":tx:");
  return marker > 0 ? sourceRef.slice(0, marker) : null;
}

export type HashCheck = { recorded: string; recomputed: string; matches: boolean };

export type SealReport = {
  algorithm: string;
  schemaVersion: string | null;
  receiptHash: HashCheck;
  integrityHash: HashCheck;
};

export type SealOutcome =
  | { state: "UNINTERPRETABLE"; reason: string }
  | { state: "CHECKED"; report: SealReport; intact: boolean };

/**
 * Recompute both seals with the functions that produced them.
 *
 * A record whose hashes cannot even be computed — an unsupported schema
 * version, a member that is not canonical JSON — is not evidence of tampering
 * and is not evidence of integrity either. It gets its own answer, because a
 * verdict nobody computed is the one thing a verifier may never print.
 */
export function checkSeal(record: Json): SealOutcome {
  const { receiptHash, integrity, ...core } = record;
  const recordedReceiptHash = lowerHash(receiptHash);
  const integrityBlock = object(integrity);
  const recordedIntegrityHash = lowerHash(integrityBlock?.hash);
  const algorithm = text(integrityBlock?.algorithm);
  if (!recordedReceiptHash || !recordedIntegrityHash || algorithm !== "SHA-256") {
    return { state: "UNINTERPRETABLE", reason: "MISSING_OR_MALFORMED_INTEGRITY_BLOCK" };
  }

  let recomputedReceiptHash: string;
  let recomputedIntegrityHash: string;
  try {
    recomputedReceiptHash = hashReceiptCore(core);
    recomputedIntegrityHash = hashCanonical({ ...core, receiptHash: recordedReceiptHash });
  } catch {
    return { state: "UNINTERPRETABLE", reason: "RECORD_IS_NOT_CANONICALLY_HASHABLE" };
  }

  const receiptCheck: HashCheck = {
    recorded: recordedReceiptHash,
    recomputed: recomputedReceiptHash,
    matches: recomputedReceiptHash === recordedReceiptHash,
  };
  const integrityCheck: HashCheck = {
    recorded: recordedIntegrityHash,
    recomputed: recomputedIntegrityHash,
    matches: recomputedIntegrityHash === recordedIntegrityHash,
  };
  return {
    state: "CHECKED",
    report: {
      algorithm,
      schemaVersion: text(core.schemaVersion),
      receiptHash: receiptCheck,
      integrityHash: integrityCheck,
    },
    intact: receiptCheck.matches && integrityCheck.matches,
  };
}

/**
 * What anyone holding a reference may be told about a receipt.
 *
 * Assembled field by field, never filtered: a redaction pass leaks whatever
 * the next schema version adds, and an allowlist omits it. Amounts, statuses,
 * timestamps, chain provenance, hashes and the receipt's own limitations —
 * never the tenant, never who approved it, never the evidence item refs, and
 * never the payout block's wallet addresses.
 */
export function publicSummary(record: Json) {
  const intent = object(record.intent);
  const execution = object(record.execution);
  const authorization = object(record.authorization);
  const reconciliation = object(record.reconciliation);
  const evidence = object(reconciliation?.evidence);
  const expected = object(record.expectedEffects);
  const actual = object(record.actualEffects);
  const limitations = Array.isArray(record.limitations)
    ? record.limitations.filter((entry): entry is string => typeof entry === "string")
    : [];

  const kindDetail = publicReceiptDetail(record);
  /* A received-payment receipt states its transaction, amount and time in its
     own block: it has no execution or effects of its own, because the team
     executed nothing. The hash is public on Arc already; the wallets are not
     read from here. */
  const received = object(record.received);

  return {
    receiptId: text(record.id),
    schemaVersion: text(record.schemaVersion),
    /* What kind of operation this receipt records, and the fields that only
       that kind has — assembled by `publicReceiptDetail` for the same reason
       this block is. */
    kind: kindDetail.kind,
    detail: kindDetail.detail,
    operationRef: text(intent?.id),
    operationRevision: typeof intent?.revision === "number" ? intent.revision : null,
    chainRef: chainRefOf(record),
    transactionHash: lowerHash(execution?.transactionHash) ?? lowerHash(received?.transactionHash),
    explorerUrl: text(execution?.explorerUrl) ?? text(received?.explorerUrl),
    amountIn: text(actual?.amountIn) ?? text(received?.amount),
    amountOut: text(actual?.amountOut),
    feeAmount: text(actual?.feeAmount),
    expectedAmountIn: text(expected?.amountIn),
    expectedAmountOut: text(expected?.amountOut),
    expectedFeeAmount: text(expected?.feeAmount),
    reconciliationStatus: text(record.reconciliationStatus),
    policyDecision: text(record.policyDecision),
    policyVersion: typeof record.policyVersion === "number" ? record.policyVersion : null,
    evidenceStatus: text(record.evidenceStatus),
    executionStatus: text(record.executionStatus),
    authorizationStatus: text(record.authorizationStatus),
    /* The method, never the subject. Who approved it is a principal inside
       someone's organization and has no business on an anonymous lookup. */
    authorizationMethod: text(authorization?.method),
    authorizedAt: text(authorization?.createdAt),
    observedAt: text(evidence?.observedAt) ?? text(received?.paidAt),
    observationProvider: text(evidence?.provider),
    observationStatus: text(evidence?.verificationStatus),
    createdAt: text(record.createdAt),
    finalizedAt: text(record.finalizedAt),
    limitations,
    proof: {
      operationHash: lowerHash(intent?.hash),
      preflightHash: lowerHash(record.preflightHash),
      policyDigest: lowerHash(record.policyDigest),
      evidenceRoot: lowerHash(object(record.evidence)?.root),
      executionFingerprintHash: lowerHash(execution?.fingerprintHash),
      reconciliationDigest: lowerHash(evidence?.responseDigest),
    },
  };
}

export type PublicReceiptSummary = ReturnType<typeof publicSummary>;

/** The verifier's three verdicts. `TAMPERED` travels without a summary. */
export type VerifierVerdict = "VERIFIED" | "TAMPERED" | "NOT_FOUND";
