/**
 * Check a Ryntra settlement receipt yourself.
 *
 * Three questions, answered separately and then together:
 *
 * 1. **Is the receipt intact?** Both seals are recomputed on this machine when
 *    the receipt file is at hand, or taken from the verifier's own
 *    recomputation when only a reference is.
 * 2. **Does the issuer's verifier hold the same receipt?** When both the file
 *    and the verifier's answer are at hand, the file's seal must be the one the
 *    verifier recorded, and the verifier's public summary must be exactly the
 *    one this package derives from the file.
 * 3. **Does Arc show what the receipt records?** The transaction is read from
 *    Arc's own published endpoints and every fact the receipt states — status,
 *    token, amounts, wallets where the receipt names them, block, fee, debit,
 *    time — is held against it (see `check.ts`).
 *
 * The verdict:
 *
 * - `CONFIRMED` — intact, and Arc shows what it records;
 * - `CONTRADICTED` — a seal is broken, the verifier's copy differs from the
 *   file, or Arc shows something else;
 * - `INCOMPLETE` — nothing contradicts the receipt, but something could not
 *   be checked: the chain could not be read, the verifier did not answer, or
 *   the kind is not one this package reads back from Arc.
 *
 * An unknown is never promoted to a success.
 */

import { canonicalJson } from "./canonical.ts";
import { checkAgainstArc, CHECKED_KINDS, factsFromReceipt, factsFromSummary, isExchangeShaped } from "./check.ts";
import type { Check, ReceiptFacts } from "./check.ts";
import { jsonRpc, readArcTransaction, readingsConflict } from "./chain.ts";
import type { EndpointNote } from "./chain.ts";
import { arcNetworkForChainRef, explorerLink, readEndpoints } from "./networks.ts";
import { checkSeal, lowerHash, normalizeReceiptReference, object, publicSummary, text } from "./receipt.ts";
import type { ReceiptKind } from "./receipt.ts";
import { askVerifier, DEFAULT_VERIFIER } from "./verifier.ts";

export type Verdict = "CONFIRMED" | "CONTRADICTED" | "INCOMPLETE";

export type VerificationReport = {
  reference: string | null;
  verdict: Verdict;
  /** Why the verdict is what it is, one sentence each. */
  reasons: string[];
  kind: ReceiptKind | null;
  schemaVersion: string | null;
  network: { id: string; label: string; chainId: number } | null;
  transactionHash: string | null;
  explorerUrl: string | null;
  seal: {
    state: "INTACT" | "BROKEN" | "UNREADABLE" | "NOT_CHECKED";
    by: "THIS_MACHINE" | "VERIFIER" | null;
    detail: string;
    receiptHash: string | null;
  };
  verifier: {
    url: string | null;
    state: "VERIFIED" | "TAMPERED" | "NOT_FOUND" | "UNREACHABLE" | "REFUSED" | "INVALID" | "NOT_ASKED";
    detail: string;
    /** Whether the verifier's copy is the receipt file given; null when there was nothing to compare. */
    sameReceipt: boolean | null;
  };
  arc: {
    state: "READ" | "NOT_FOUND" | "UNREADABLE" | "CONFLICT" | "NOT_READ";
    sources: string[];
    skipped: EndpointNote[];
    blockNumber: number | null;
    blockTimestamp: string | null;
    confirmations: number | null;
  };
  checks: Check[];
  notes: string[];
};

export type VerifyOptions = {
  /** A receipt id, an operation id, a seal or the transaction hash. */
  reference?: string | null;
  /** The receipt JSON, when you hold it. */
  receipt?: unknown;
  /** The verifier to ask; `null` asks none. */
  verifier?: string | null;
  /** Arc JSON-RPC endpoints to read through, in order; defaults to the network's published ones. */
  rpc?: readonly string[];
  fetchImpl?: typeof fetch;
};

function kindWord(facts: ReceiptFacts): string {
  if (facts.kind === "PAYOUT") return "payout";
  if (isExchangeShaped(facts)) return "exchange";
  if (facts.kind === "TRANSFER") return "transfer";
  return "operation";
}

export async function verifyReceipt(options: VerifyOptions): Promise<VerificationReport> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const verifierUrl = options.verifier === undefined ? DEFAULT_VERIFIER : options.verifier;
  const reasons: string[] = [];
  const notes: string[] = [];
  const report: VerificationReport = {
    reference: null,
    verdict: "INCOMPLETE",
    reasons,
    kind: null,
    schemaVersion: null,
    network: null,
    transactionHash: null,
    explorerUrl: null,
    seal: { state: "NOT_CHECKED", by: null, detail: "no receipt or verifier answer to recompute", receiptHash: null },
    verifier: { url: verifierUrl, state: "NOT_ASKED", detail: "not asked", sameReceipt: null },
    arc: { state: "NOT_READ", sources: [], skipped: [], blockNumber: null, blockTimestamp: null, confirmations: null },
    checks: [],
    notes,
  };
  let contradicted = false;

  /* 1. The receipt file, when there is one: its seals, on this machine. */
  const record = options.receipt === undefined ? null : object(options.receipt);
  if (options.receipt !== undefined && !record) {
    report.seal = { state: "UNREADABLE", by: "THIS_MACHINE", detail: "the receipt file is not a JSON object", receiptHash: null };
    reasons.push("The receipt file is not a receipt this tool can read.");
    return report;
  }
  if (record) {
    const seal = checkSeal(record);
    if (seal.state === "UNINTERPRETABLE") {
      report.seal = { state: "UNREADABLE", by: "THIS_MACHINE", detail: seal.reason, receiptHash: lowerHash(record.receiptHash) };
      reasons.push("The receipt's seals cannot be recomputed, so nothing it states can be trusted or refuted.");
      return report;
    }
    report.seal = {
      state: seal.intact ? "INTACT" : "BROKEN",
      by: "THIS_MACHINE",
      detail: seal.intact
        ? "both hashes recomputed on this machine match the recorded ones"
        : `recomputed on this machine: receipt hash ${seal.report.receiptHash.matches ? "matches" : "differs"}, integrity hash ${seal.report.integrityHash.matches ? "matches" : "differs"}`,
      receiptHash: seal.report.receiptHash.recorded,
    };
    if (!seal.intact) {
      contradicted = true;
      reasons.push("The receipt was changed after it was sealed: its recomputed hashes differ from the recorded ones.");
    }
  }

  /* 2. The verifier, when one is named. */
  const reference = normalizeReceiptReference(options.reference ?? null) ?? (record ? normalizeReceiptReference(text(record.id)) : null);
  report.reference = reference;
  let summary: Record<string, unknown> | null = null;
  if (verifierUrl !== null && reference !== null) {
    const answer = await askVerifier(reference, { verifier: verifierUrl, fetchImpl });
    if (answer.state !== "ANSWERED") {
      report.verifier = { url: verifierUrl, state: answer.state, detail: answer.detail, sameReceipt: null };
    } else {
      report.verifier = { url: verifierUrl, state: answer.verdict, detail: answer.verdict.toLowerCase().replace("_", " "), sameReceipt: null };
      if (answer.verdict === "VERIFIED") summary = answer.summary;
      if (!record && answer.integrity) {
        const intact = answer.verdict === "VERIFIED";
        report.seal = {
          state: intact ? "INTACT" : "BROKEN",
          by: "VERIFIER",
          detail: intact
            ? "both hashes recomputed by the verifier match the recorded ones"
            : "the verifier recomputed the hashes and they differ from the recorded ones",
          receiptHash: answer.integrity.receiptHash.recorded,
        };
        if (!intact) {
          contradicted = true;
          reasons.push("The verifier reports that its copy of the receipt was changed after it was sealed.");
        }
      }
      if (record && report.seal.state === "INTACT") {
        if (answer.verdict === "NOT_FOUND") {
          notes.push("The verifier holds no receipt with this reference; the file is checked on its own.");
        } else {
          const sameSeal = answer.integrity?.receiptHash.recorded === report.seal.receiptHash;
          const sameSummary = answer.verdict !== "VERIFIED" || canonicalJson(publicSummary(record)) === canonicalJson(summary);
          report.verifier.sameReceipt = sameSeal && sameSummary && answer.verdict === "VERIFIED";
          if (!report.verifier.sameReceipt) {
            contradicted = true;
            reasons.push("The verifier holds a different receipt under this reference than the file you hold.");
          }
        }
      }
    }
  }

  /* 3. Arc. */
  const facts: ReceiptFacts | null = record ? factsFromReceipt(record) : summary ? factsFromSummary(summary) : null;
  if (!facts) {
    if (report.verifier.state === "NOT_FOUND") reasons.push("The verifier holds no receipt with this reference.");
    else if (report.verifier.state === "TAMPERED") reasons.push("The verifier does not describe a tampered receipt, so there is nothing to read back from Arc.");
    else if (reference === null) reasons.push("There is neither a receipt file nor a reference to look up.");
    else reasons.push(`The verifier could not be asked about this reference (${report.verifier.detail}).`);
    report.verdict = contradicted ? "CONTRADICTED" : "INCOMPLETE";
    return report;
  }
  report.kind = facts.kind;
  report.schemaVersion = facts.schemaVersion;
  report.transactionHash = facts.transactionHash;

  const network = arcNetworkForChainRef(facts.chainRef);
  if (network) {
    report.network = { id: network.id, label: network.label, chainId: network.chainId };
    if (facts.transactionHash) report.explorerUrl = explorerLink(network, facts.transactionHash);
  }
  if (!CHECKED_KINDS.includes(facts.kind)) {
    reasons.push(`A ${facts.kind.toLowerCase()} receipt is not read back from Arc by this tool.`);
  } else if (!network) {
    reasons.push(`The receipt names ${facts.chainRef ?? "no chain"}, not an Arc network this tool reads.`);
  } else if (!facts.transactionHash) {
    reasons.push("The receipt names no transaction to read.");
  } else {
    if (facts.kind === "TRANSFER" && isExchangeShaped(facts)) {
      notes.push("This receipt was issued under a transfer schema, but its amounts describe an exchange; it is checked as the exchange it records.");
    }
    const read = await readArcTransaction({
      network,
      transactionHash: facts.transactionHash,
      endpoints: options.rpc && options.rpc.length > 0 ? options.rpc : readEndpoints(network),
      call: jsonRpc(fetchImpl),
    });
    report.arc.skipped = [...read.notes];
    if (read.state !== "READ") {
      report.arc.state = read.state;
      reasons.push(
        read.state === "NOT_FOUND"
          ? `No endpoint that answered has this transaction on ${network.label}; a node without deep history says the same about one that exists.`
          : `No ${network.label} endpoint could be read.`,
      );
    } else {
      const conflict = readingsConflict(read.readings);
      const [reading] = read.readings;
      report.arc.sources = read.readings.map((entry) => entry.endpoint);
      report.arc.blockNumber = reading.blockNumber;
      report.arc.blockTimestamp = reading.blockTimestamp;
      report.arc.confirmations = Math.max(0, reading.headBlock - reading.blockNumber + 1);
      if (conflict) {
        report.arc.state = "CONFLICT";
        reasons.push(`The Arc endpoints disagree: ${conflict}.`);
      } else {
        report.arc.state = "READ";
        report.checks = checkAgainstArc(facts, reading, network);
        const failed = report.checks.filter((check) => check.status === "MISMATCH");
        if (failed.length > 0) {
          contradicted = true;
          reasons.push(`Arc shows something other than the receipt records: ${failed.map((check) => check.id).join(", ")}.`);
        }
      }
    }
  }

  const chainConfirmed = report.arc.state === "READ" && report.checks.length > 0 && report.checks.every((check) => check.status !== "MISMATCH");
  if (contradicted) {
    report.verdict = "CONTRADICTED";
  } else if (report.seal.state === "INTACT" && chainConfirmed) {
    report.verdict = "CONFIRMED";
    reasons.unshift(
      `The receipt is intact (${report.seal.by === "THIS_MACHINE" ? "recomputed on this machine" : "recomputed by the verifier"}) and Arc shows the ${kindWord(facts)} it records.`,
    );
  } else {
    report.verdict = "INCOMPLETE";
    if (report.seal.state !== "INTACT" && reasons.length === 0) reasons.push("The receipt's seals were not checked.");
  }
  return report;
}
