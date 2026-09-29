import { KYBER_FEE_TOPIC, type KyberFeeLog } from "./kyber-fee.ts";
/**
 * One Arc transaction, read back from the chain over plain JSON-RPC.
 *
 * Read-only by construction: the only methods called are `eth_chainId`,
 * `eth_getTransactionReceipt`, `eth_getTransactionByHash`,
 * `eth_getBlockByNumber`, `eth_blockNumber` and an `eth_call` of the token's
 * `decimals()`. Nothing is signed and nothing is sent.
 *
 * ## An endpoint that cannot answer is not an answer
 *
 * The published endpoints are tried in order. One that refuses the request,
 * times out or serves another chain is skipped and named in the notes; one
 * that answers `null` for the receipt is recorded as not having seen the
 * transaction, because a node that does not keep history that deep says
 * exactly that about a transaction that exists. So:
 *
 * - `READ` — at least one endpoint returned the transaction, its receipt and
 *   its block; up to `sources` endpoints are read so they can be compared;
 * - `NOT_FOUND` — every endpoint that answered said it has no such receipt;
 * - `UNREADABLE` — no endpoint answered at all.
 *
 * Neither of the last two is evidence that a payment did not happen, and the
 * verifier never turns them into one.
 */

import { circleTokens, readEndpoints } from "./networks.ts";
import type { ArcNetwork } from "./networks.ts";

/** `keccak256("Transfer(address,address,uint256)")`, the ERC-20 Transfer event. */
export const ERC20_TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

/** `decimals()` */
const DECIMALS_SELECTOR = "0x313ce567";

export type RpcCall = (endpoint: string, method: string, params: readonly unknown[]) => Promise<unknown>;

export class RpcError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RpcError";
  }
}

type Json = Record<string, unknown>;

function object(value: unknown): Json | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Json) : null;
}

const QUANTITY = /^0x[0-9a-fA-F]{1,64}$/;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const HASH = /^0x[0-9a-fA-F]{64}$/;
const WORD = /^0x[0-9a-fA-F]{64}$/;

function quantity(value: unknown): bigint | null {
  return typeof value === "string" && QUANTITY.test(value) ? BigInt(value) : null;
}

function smallNumber(value: unknown): number | null {
  const parsed = quantity(value);
  return parsed !== null && parsed <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(parsed) : null;
}

function address(value: unknown): string | null {
  return typeof value === "string" && ADDRESS.test(value) ? value.toLowerCase() : null;
}

function hash(value: unknown): string | null {
  return typeof value === "string" && HASH.test(value) ? value.toLowerCase() : null;
}

/** A JSON-RPC 2.0 client over `fetch`, with a per-request timeout. */
export function jsonRpc(fetchImpl: typeof fetch = fetch, timeoutMs = 15_000): RpcCall {
  let id = 0;
  return async (endpoint, method, params) => {
    id += 1;
    let response: Response;
    try {
      response = await fetchImpl(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      throw new RpcError(error instanceof Error && error.name === "TimeoutError" ? "timed out" : "could not be reached");
    }
    if (!response.ok) throw new RpcError(`HTTP ${response.status}`);
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new RpcError("answered with something that is not JSON");
    }
    const envelope = object(body);
    if (!envelope) throw new RpcError("answered with something that is not a JSON-RPC response");
    const error = object(envelope.error);
    if (error) throw new RpcError(`JSON-RPC error ${typeof error.code === "number" ? error.code : ""}`.trim());
    if (!("result" in envelope)) throw new RpcError("answered without a result");
    return envelope.result;
  };
}

/** One decoded ERC-20 Transfer event. Addresses are lowercase. */
export type TokenTransfer = Readonly<{
  logIndex: number;
  token: string;
  from: string;
  to: string;
  amount: bigint;
}>;

/** What one endpoint says about one transaction. Every member is present. */
export type ArcTransactionReading = Readonly<{
  endpoint: string;
  chainId: number;
  transactionHash: string;
  from: string;
  to: string | null;
  valueWei: bigint;
  status: "success" | "reverted";
  blockNumber: number;
  blockHash: string;
  blockTimestamp: string;
  transactionIndex: number;
  gasUsed: bigint;
  /** Native USDC per gas, in the 18-decimal native unit. */
  effectiveGasPriceWei: bigint;
  /** Every ERC-20 Transfer event in the transaction, from any contract. */
  transfers: readonly TokenTransfer[];
  /** Optional for older readings; self-fees cannot be proved without these chain facts. */
  input?: string | null;
  kyberFeeLogs?: readonly KyberFeeLog[] | null;
  /** `decimals()` of each Circle token that moved, by lowercase address. */
  tokenDecimals: Readonly<Record<string, number | null>>;
  headBlock: number;
}>;

export type EndpointNote = Readonly<{
  endpoint: string;
  outcome: "UNREACHABLE" | "OTHER_CHAIN" | "NOT_SEEN" | "INCONSISTENT";
  detail: string;
}>;

export type ArcReadOutcome =
  | Readonly<{ state: "READ"; readings: readonly ArcTransactionReading[]; notes: readonly EndpointNote[] }>
  | Readonly<{ state: "NOT_FOUND"; notes: readonly EndpointNote[] }>
  | Readonly<{ state: "UNREADABLE"; notes: readonly EndpointNote[] }>;

/** The Transfer events in a receipt's logs; anything else is ignored. */
export function decodeTransfers(logs: unknown): TokenTransfer[] | null {
  if (!Array.isArray(logs)) return null;
  const transfers: TokenTransfer[] = [];
  for (const entry of logs) {
    const log = object(entry);
    if (!log) return null;
    const topics = Array.isArray(log.topics) ? log.topics : [];
    if (topics.length !== 3 || String(topics[0]).toLowerCase() !== ERC20_TRANSFER_TOPIC) continue;
    const token = address(log.address);
    const logIndex = smallNumber(log.logIndex);
    const from = typeof topics[1] === "string" && WORD.test(topics[1]) ? `0x${topics[1].slice(-40).toLowerCase()}` : null;
    const to = typeof topics[2] === "string" && WORD.test(topics[2]) ? `0x${topics[2].slice(-40).toLowerCase()}` : null;
    const amount = typeof log.data === "string" && WORD.test(log.data) ? BigInt(log.data) : null;
    if (token === null || logIndex === null || from === null || to === null || amount === null) return null;
    transfers.push({ logIndex, token, from, to, amount });
  }
  return transfers;
}

function kyberFeeLogs(logs: unknown): readonly KyberFeeLog[] | null {
  if (!Array.isArray(logs)) return null;
  const result: KyberFeeLog[] = [];
  for (const entry of logs) {
    const log = object(entry);
    if (!log || !Array.isArray(log.topics) || String(log.topics[0]).toLowerCase() !== KYBER_FEE_TOPIC) continue;
    const emitter = address(log.address);
    const logIndex = smallNumber(log.logIndex);
    if (!emitter || logIndex === null || typeof log.data !== "string" || !/^0x(?:[0-9a-fA-F]{2})*$/.test(log.data) || !log.topics.every((topic) => typeof topic === "string")) return null;
    result.push({ address: emitter, topics: log.topics.map((topic: string) => topic.toLowerCase()), data: log.data.toLowerCase(), ...{ logIndex } });
  }
  return result;
}

function decodeReading(
  endpoint: string,
  chainId: number,
  transactionHash: string,
  receipt: Json,
  transaction: Json,
  block: Json,
  headBlock: number | null,
): Omit<ArcTransactionReading, "tokenDecimals"> | string {
  if (hash(receipt.transactionHash) !== transactionHash) return "returned a receipt for another transaction";
  if (hash(transaction.hash) !== transactionHash) return "returned another transaction";
  const status = receipt.status === "0x1" ? "success" : receipt.status === "0x0" ? "reverted" : null;
  const from = address(transaction.from);
  const to = transaction.to === null ? null : address(transaction.to);
  const valueWei = quantity(transaction.value);
  const blockNumber = smallNumber(receipt.blockNumber);
  const blockHash = hash(receipt.blockHash);
  const transactionIndex = smallNumber(receipt.transactionIndex);
  const gasUsed = quantity(receipt.gasUsed);
  const effectiveGasPriceWei = quantity(receipt.effectiveGasPrice) ?? quantity(transaction.gasPrice);
  const timestamp = smallNumber(block.timestamp);
  const transfers = decodeTransfers(receipt.logs);
  if (
    status === null || from === null || (transaction.to !== null && to === null) || valueWei === null
    || blockNumber === null || blockHash === null || transactionIndex === null || gasUsed === null
    || effectiveGasPriceWei === null || timestamp === null || transfers === null || headBlock === null
  ) {
    return "returned a transaction, receipt or block with a missing or malformed member";
  }
  if (hash(block.hash) !== blockHash || smallNumber(block.number) !== blockNumber) {
    return "returned a block that is not the one the receipt names";
  }
  return {
    endpoint,
    chainId,
    transactionHash,
    from,
    to,
    valueWei,
    status,
    blockNumber,
    blockHash,
    blockTimestamp: new Date(timestamp * 1000).toISOString(),
    transactionIndex,
    gasUsed,
    effectiveGasPriceWei,
    transfers,
    input: typeof transaction.input === "string" && /^0x(?:[0-9a-fA-F]{2})*$/.test(transaction.input) ? transaction.input.toLowerCase() : null,
    kyberFeeLogs: kyberFeeLogs(receipt.logs),
    headBlock,
  };
}

function reason(error: unknown): string {
  if (error instanceof RpcError) return error.message;
  return "failed while reading";
}

/**
 * Read one transaction on one Arc network.
 *
 * `endpoints` defaults to every endpoint the network publishes, in
 * {@link readEndpoints} order. `sources` is how many answering endpoints to
 * read before stopping; two lets a reader compare them.
 */
export async function readArcTransaction({
  network,
  transactionHash,
  endpoints = readEndpoints(network),
  call = jsonRpc(),
  sources = 2,
}: {
  network: ArcNetwork;
  transactionHash: string;
  endpoints?: readonly string[];
  call?: RpcCall;
  sources?: number;
}): Promise<ArcReadOutcome> {
  const wanted = transactionHash.toLowerCase();
  const readings: ArcTransactionReading[] = [];
  const notes: EndpointNote[] = [];
  for (const endpoint of endpoints) {
    if (readings.length >= sources) break;
    try {
      const chainId = smallNumber(await call(endpoint, "eth_chainId", []));
      if (chainId === null) {
        notes.push({ endpoint, outcome: "INCONSISTENT", detail: "answered eth_chainId with something that is not a number" });
        continue;
      }
      if (chainId !== network.chainId) {
        notes.push({ endpoint, outcome: "OTHER_CHAIN", detail: `serves chain id ${chainId}, not ${network.label} (${network.chainId})` });
        continue;
      }
      const receipt = object(await call(endpoint, "eth_getTransactionReceipt", [wanted]));
      if (!receipt) {
        notes.push({ endpoint, outcome: "NOT_SEEN", detail: "has no receipt for this transaction" });
        continue;
      }
      const transaction = object(await call(endpoint, "eth_getTransactionByHash", [wanted]));
      const block = object(await call(endpoint, "eth_getBlockByNumber", [receipt.blockNumber, false]));
      const headBlock = smallNumber(await call(endpoint, "eth_blockNumber", []));
      if (!transaction || !block) {
        notes.push({ endpoint, outcome: "INCONSISTENT", detail: "has the receipt but not the transaction or its block" });
        continue;
      }
      const decoded = decodeReading(endpoint, chainId, wanted, receipt, transaction, block, headBlock);
      if (typeof decoded === "string") {
        notes.push({ endpoint, outcome: "INCONSISTENT", detail: decoded });
        continue;
      }
      const tokenDecimals: Record<string, number | null> = {};
      for (const token of circleTokens(network)) {
        const tokenAddress = token.address.toLowerCase();
        if (!decoded.transfers.some((transfer) => transfer.token === tokenAddress)) continue;
        tokenDecimals[tokenAddress] = smallNumber(
          await call(endpoint, "eth_call", [{ to: token.address, data: DECIMALS_SELECTOR }, "latest"]),
        );
      }
      readings.push({ ...decoded, tokenDecimals });
    } catch (error) {
      notes.push({ endpoint, outcome: "UNREACHABLE", detail: reason(error) });
    }
  }
  if (readings.length > 0) return { state: "READ", readings, notes };
  if (notes.some((note) => note.outcome === "NOT_SEEN")) return { state: "NOT_FOUND", notes };
  return { state: "UNREADABLE", notes };
}

/** The facts two endpoints must agree on, as comparable text. */
function fingerprint(reading: ArcTransactionReading): Record<string, string> {
  return {
    chainId: String(reading.chainId),
    status: reading.status,
    from: reading.from,
    to: String(reading.to),
    value: reading.valueWei.toString(),
    block: `${reading.blockNumber}:${reading.blockHash}:${reading.transactionIndex}`,
    blockTimestamp: reading.blockTimestamp,
    gas: `${reading.gasUsed}x${reading.effectiveGasPriceWei}`,
    transfers: reading.transfers.map((transfer) => `${transfer.logIndex}:${transfer.token}:${transfer.from}:${transfer.to}:${transfer.amount}`).join(","),
    input: reading.input ?? "",
    kyberFeeLogs: JSON.stringify(reading.kyberFeeLogs ?? null),
    decimals: Object.entries(reading.tokenDecimals).map(([token, decimals]) => `${token}=${decimals}`).join(","),
  };
}

/** The first fact two endpoints disagree on, or null when they all agree. */
export function readingsConflict(readings: readonly ArcTransactionReading[]): string | null {
  const [first, ...rest] = readings;
  if (!first) return null;
  const expected = fingerprint(first);
  for (const other of rest) {
    const actual = fingerprint(other);
    for (const key of Object.keys(expected)) {
      if (expected[key] !== actual[key]) return `${first.endpoint} and ${other.endpoint} disagree on ${key}`;
    }
  }
  return null;
}
