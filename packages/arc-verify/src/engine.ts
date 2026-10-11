/**
 * Checking a receipt of what Ryntra's executor did on Arc (receipt 2.0.0).
 *
 * Besides the two SHA-256 seals every Ryntra receipt carries, a 2.0.0 receipt is signed (EIP-712, by
 * Ryntra's receipt key) and, once its hour has closed, anchored (a Merkle root on `ReceiptAnchor`).
 * Every claim is checked on its own, and an unknown never becomes a success:
 *
 * | check            | what it holds                                                                         |
 * |------------------|---------------------------------------------------------------------------------------|
 * | `signature`      | the EIP-712 digest recomputed from the receipt is the one signed, and the signature recovers to the named signer |
 * | `receipt-key`    | that signer is Ryntra's `receipt-signer` key for the network on the day it signed (`keys.ts`) |
 * | `anchor-contract`| the receipt's verifying contract is Ryntra's ReceiptAnchor on that network             |
 * | `transaction`    | Arc shows the transaction: succeeded, sent by the named executor to the named contract, in the named block |
 * | `executor-key`   | the sender is Ryntra's `executor` key for that network on that day                     |
 * | `anchor`         | the proof leads from the digest to the root, and Arc's anchor holds that root and count for the writer and hour |
 * | `anchor-writer`  | the writer is Ryntra's `executor` key on the day it wrote                             |
 * | `reconciliation` | the receipt says the chain matched what the action promised; one a person resolved is never CONFIRMED |
 *
 * A receipt that is not anchored yet (its hour has not closed) is `INCOMPLETE`, never `CONFIRMED`.
 *
 * Read-only: `eth_chainId`, the transaction's reads (`chain.ts`) and one `eth_call` of the anchor.
 */

import { readAnchorRecord, rootOfProof } from "./anchor.ts";
import type { Check } from "./check.ts";
import { jsonRpc, readArcTransaction, readingsConflict, type RpcCall } from "./chain.ts";
import { receiptDigest, type ReceiptDomain, type ReceiptMessage } from "./eip712.ts";
import { BUNDLED_REGISTRY, contractTrust, keyTrust, momentOf, type ArcRegistry, type Trust } from "./keys.ts";
import { arcNetworkForChainRef, explorerLink, readEndpoints } from "./networks.ts";
import { recoverAddress } from "./secp256k1.ts";

type Json = Record<string, unknown>;
const object = (value: unknown): Json | null => (value && typeof value === "object" && !Array.isArray(value) ? (value as Json) : null);
const text = (value: unknown): string | null => (typeof value === "string" && value.length > 0 ? value : null);

export const ENGINE_SCHEMA_VERSION = "2.0.0";
const ZERO32 = `0x${"0".repeat(64)}`;
const EPOCH_SECONDS = 3_600;

const isMarketAction = (action: string | null) => action !== null && (action.startsWith("vault.") || action === "anchor.write");

/**
 * What anyone holding a reference may see of an engine receipt — the verifier's summary: the signed fields, the
 * seals, the signature and the anchor, enough to check them all. Not a treasury's why, balances or counterparties
 * (a vault's ladder and an anchor are public records, so their fields are shown).
 */
export function publicEngineView(record: Json) {
  const action = object(record.action);
  const flight = object(record.flight);
  const reconciliation = object(record.reconciliation);
  const kind = text(action?.kind);
  return {
    receiptId: text(record.id),
    schemaVersion: text(record.schemaVersion),
    kind: "ENGINE" as const,
    environment: text(record.environment),
    chainRef: text(record.chainRef),
    issuedAt: text(record.issuedAt),
    operationId: text(record.operationId),
    action: kind,
    target: text(action?.target),
    fields: isMarketAction(kind) ? (object(action?.fields) ?? null) : null,
    rule: object(flight?.rule) ?? null,
    constitution: text(object(flight?.rule)?.constitution),
    proof: object(record.proof) ?? null,
    reconciled: typeof reconciliation?.ok === "boolean" ? reconciliation.ok : null,
    resolvedByPerson: reconciliation ? reconciliation.resolved !== null && reconciliation.resolved !== undefined : null,
    limitations: Array.isArray(record.limitations) ? record.limitations.filter((v): v is string => typeof v === "string") : [],
    eip712: object(record.eip712) ?? null,
    receiptHash: text(record.receiptHash),
    integrity: object(record.integrity) ?? null,
    signature: object(record.signature) ?? null,
    anchor: object(record.anchor) ?? null,
  };
}
export type PublicEngineView = ReturnType<typeof publicEngineView>;

/** The signed domain and message, from a full receipt or from its public view. */
export function signedParts(source: Json): { domain: ReceiptDomain; message: ReceiptMessage; issuedAt: number } | string {
  const view = text(source.receiptId) ? source : publicEngineView(source);
  const eip712 = object(view.eip712);
  const proof = object(view.proof);
  const chainId = typeof eip712?.chainId === "number" ? eip712.chainId : null;
  const verifyingContract = text(eip712?.verifyingContract);
  const issuedAt = momentOf(view.issuedAt);
  const receiptHash = text(view.receiptHash);
  const action = text(view.action);
  const target = text(view.target);
  const executor = text(proof?.executor);
  const operationId = text(view.operationId);
  if (chainId === null || !verifyingContract || !Number.isFinite(issuedAt) || !receiptHash || !action || !target || !executor || !operationId) {
    return "the receipt does not carry its signed fields";
  }
  if (eip712?.name !== "Ryntra Receipt" || eip712?.version !== "2" || eip712?.primaryType !== "Receipt") return "the receipt's EIP-712 domain is not Ryntra's receipt domain";
  const blockNumber = text(proof?.blockNumber);
  return {
    domain: { chainId, verifyingContract },
    message: {
      operationId,
      action,
      target,
      executor,
      transactionHash: text(proof?.transactionHash) ?? ZERO32,
      blockNumber: blockNumber ?? "0",
      constitution: text(view.constitution) ?? text(object(view.rule)?.constitution) ?? ZERO32,
      record: receiptHash,
      issuedAt: String(Math.floor(issuedAt / 1000)),
    },
    issuedAt,
  };
}

const fromTrust = (id: string, trust: Trust): Check => ({
  id,
  status: trust.state === "TRUSTED" ? "MATCH" : trust.state === "NOT_TRUSTED" ? "MISMATCH" : "NOT_RECORDED",
  detail: trust.detail,
});

export type EngineCheckOptions = Readonly<{
  registry?: ArcRegistry;
  rpc?: readonly string[];
  call?: RpcCall;
  fetchImpl?: typeof fetch;
}>;

export type EngineCheck = {
  checks: Check[];
  notes: string[];
  network: { id: string; label: string; chainId: number } | null;
  transactionHash: string | null;
  explorerUrl: string | null;
  arc: { sources: string[]; blockNumber: number | null; blockTimestamp: string | null; confirmations: number | null };
};

/**
 * Every check of a 2.0.0 receipt but its seals (those are `receipt.ts` `checkSeal`, the same for every version):
 * `source` is the full receipt or the verifier's public view of it.
 */
export async function checkEngineReceipt(source: Json, options: EngineCheckOptions = {}): Promise<EngineCheck> {
  const registry = options.registry ?? BUNDLED_REGISTRY;
  const call = options.call ?? jsonRpc(options.fetchImpl ?? fetch);
  const checks: Check[] = [];
  const notes: string[] = [];
  const result: EngineCheck = { checks, notes, network: null, transactionHash: null, explorerUrl: null, arc: { sources: [], blockNumber: null, blockTimestamp: null, confirmations: null } };
  const parts = signedParts(source);
  if (typeof parts === "string") {
    checks.push({ id: "signature", status: "MISMATCH", detail: parts });
    return result;
  }
  const { domain, message, issuedAt } = parts;
  const view = text(source.receiptId) ? source : publicEngineView(source);
  const signature = object(view.signature);
  const action = text(view.action);
  const anchor = object(view.anchor);
  const chainId = domain.chainId;
  const network = arcNetworkForChainRef(`eip155:${chainId}`);
  if (network) result.network = { id: network.id, label: network.label, chainId };
  const endpoints = options.rpc && options.rpc.length > 0 ? options.rpc : network ? readEndpoints(network) : [];

  /* The signature: the digest recomputed here, recovered here. */
  let digest: string | null = null;
  try {
    digest = receiptDigest(domain, message);
  } catch (error) {
    checks.push({ id: "signature", status: "MISMATCH", detail: `the signed fields are malformed: ${error instanceof Error ? error.message : "unknown"}` });
  }
  const signer = text(signature?.signer)?.toLowerCase() ?? null;
  if (digest) {
    if (signature?.scheme !== "EIP-712" || text(signature?.digest) !== digest) {
      checks.push({ id: "signature", status: "MISMATCH", detail: "the digest the receipt names is not its EIP-712 digest" });
    } else {
      const recovered = recoverAddress(digest, text(signature?.value) ?? "");
      checks.push(
        recovered !== null && recovered === signer
          ? { id: "signature", status: "MATCH", detail: `EIP-712 signature by ${signer}, recomputed and recovered on this machine` }
          : { id: "signature", status: "MISMATCH", detail: recovered ? `the signature recovers to ${recovered}, not the named signer` : "the signature is malformed or high-s" },
      );
    }
  }
  if (signer) checks.push(fromTrust("receipt-key", keyTrust(registry, "receipt-signer", chainId, signer, issuedAt)));
  checks.push(fromTrust("anchor-contract", contractTrust(registry, "ReceiptAnchor", chainId, domain.verifyingContract, issuedAt)));

  /* The transaction. */
  const tx = message.transactionHash === ZERO32 ? null : message.transactionHash;
  result.transactionHash = tx;
  if (!tx) {
    checks.push({ id: "transaction", status: "NOT_RECORDED", detail: "no transaction: a person checked that the action happened and resolved it" });
  } else if (!network) {
    checks.push({ id: "transaction", status: "NOT_RECORDED", detail: `chain ${chainId} is not an Arc network this tool reads` });
  } else {
    result.explorerUrl = explorerLink(network, tx);
    const read = await readArcTransaction({ network, transactionHash: tx, endpoints, call });
    if (read.state !== "READ") {
      checks.push({ id: "transaction", status: "NOT_RECORDED", detail: read.state === "NOT_FOUND" ? "no endpoint that answered has this transaction" : `no ${network.label} endpoint could be read` });
    } else {
      const conflict = readingsConflict(read.readings);
      const [reading] = read.readings;
      result.arc.sources = read.readings.map((r) => r.endpoint);
      result.arc.blockNumber = reading.blockNumber;
      result.arc.blockTimestamp = reading.blockTimestamp;
      result.arc.confirmations = Math.max(0, reading.headBlock - reading.blockNumber + 1);
      if (conflict) {
        checks.push({ id: "transaction", status: "NOT_RECORDED", detail: `the endpoints disagree: ${conflict}` });
      } else {
        const wrong = [
          reading.status !== "success" ? `it ${reading.status}` : null,
          reading.from !== message.executor ? `it was sent by ${reading.from}` : null,
          reading.to !== message.target ? `it called ${reading.to ?? "no contract"}` : null,
          String(reading.blockNumber) !== message.blockNumber ? `it is in block ${reading.blockNumber}, not ${message.blockNumber}` : null,
        ].filter(Boolean);
        checks.push(
          wrong.length === 0
            ? { id: "transaction", status: "MATCH", detail: `succeeded in block ${reading.blockNumber}, sent by ${message.executor} to ${message.target}` }
            : { id: "transaction", status: "MISMATCH", detail: wrong.join("; ") },
        );
        checks.push(fromTrust("executor-key", keyTrust(registry, "executor", chainId, message.executor, Date.parse(reading.blockTimestamp))));
      }
    }
  }

  /* The reconciliation: a person who closed a disagreement is told, never hidden behind a success. */
  if (view.reconciled === true && view.resolvedByPerson !== true) {
    checks.push({ id: "reconciliation", status: "MATCH", detail: "the chain matched what the action promised, event by event and balance by balance" });
  } else if (view.reconciled === false && view.resolvedByPerson === true) {
    checks.push({ id: "reconciliation", status: "NOT_RECORDED", detail: "the chain did not match what the action promised, and a person who looked resolved it" });
  } else {
    checks.push({ id: "reconciliation", status: "NOT_RECORDED", detail: "the receipt does not say how its reconciliation ended" });
  }

  /* The anchor. */
  if (!anchor) {
    checks.push({
      id: "anchor",
      status: "NOT_RECORDED",
      detail:
        action === "anchor.write"
          ? "the receipt of an anchor is anchored only with its hour's other receipts; the anchor it records is itself on Arc"
          : "not anchored yet — Ryntra anchors each hour's receipts on Arc after the hour closes",
    });
  } else if (digest) {
    const contract = text(anchor.contract)?.toLowerCase() ?? "";
    const writer = text(anchor.writer)?.toLowerCase() ?? "";
    const epoch = text(anchor.epoch) ?? "";
    const root = text(anchor.root)?.toLowerCase() ?? "";
    const count = typeof anchor.count === "number" ? anchor.count : null;
    const proof = Array.isArray(anchor.proof) ? anchor.proof : null;
    const ownEpoch = String(Math.floor(issuedAt / 1000 / EPOCH_SECONDS));
    if (contract !== domain.verifyingContract) {
      checks.push({ id: "anchor", status: "MISMATCH", detail: "anchored on another contract than the receipt names" });
    } else if (epoch !== ownEpoch) {
      checks.push({ id: "anchor", status: "MISMATCH", detail: `anchored as hour ${epoch}, signed in hour ${ownEpoch}` });
    } else if (!proof || rootOfProof(digest, proof) !== root || count === null) {
      checks.push({ id: "anchor", status: "MISMATCH", detail: "the proof does not lead from the receipt to the root it names" });
    } else if (endpoints.length === 0) {
      checks.push({ id: "anchor", status: "NOT_RECORDED", detail: `chain ${chainId} is not an Arc network this tool reads` });
    } else {
      const reading = await readAnchorRecord({ chainId, anchor: contract, writer, epoch, endpoints, call });
      if (reading.state === "READ") {
        const same = reading.record.root === root && reading.record.count === count;
        checks.push(
          same
            ? { id: "anchor", status: "MATCH", detail: `in hour ${epoch} anchored by ${writer}: root and ${count} receipts as on Arc (${reading.record.anchoredAt})` }
            : { id: "anchor", status: "MISMATCH", detail: `Arc's anchor holds root ${reading.record.root} of ${reading.record.count} for that writer and hour` },
        );
        checks.push(fromTrust("anchor-writer", keyTrust(registry, "executor", chainId, writer, Date.parse(reading.record.anchoredAt))));
      } else if (reading.state === "NOT_ANCHORED") {
        checks.push({ id: "anchor", status: "MISMATCH", detail: `Arc's anchor holds nothing for ${writer} in hour ${epoch}` });
      } else {
        checks.push({ id: "anchor", status: "NOT_RECORDED", detail: reading.state === "CONFLICT" ? reading.detail : `the anchor could not be read: ${reading.detail}` });
      }
    }
  }
  return result;
}
