/**
 * Whether a receipt is in the epoch Ryntra anchored on Arc (receipt 2.0.0;
 * the anchor of Ryntra's receipts).
 *
 * Once an epoch, Ryntra's executor writes to its `ReceiptAnchor` the root of a
 * Merkle tree over the epoch's receipt digests (their EIP-712 digests). The
 * contract has no owner and no list of writers: a record is the writer's, and
 * a verifier trusts only the writers Ryntra publishes in its key registry for
 * the day they wrote (`keys.ts`). Here:
 *
 * - **The proof** — a leaf is `keccak256(abi.encode(digest))` (32 bytes hashed,
 *   so an inner node of 64 bytes can never pass for a receipt) and every pair
 *   hashes sorted: the rule of OpenZeppelin's `MerkleProof`, which the
 *   contract's own `verify` uses, and of the tree Ryntra builds when it
 *   anchors an hour.
 * - **The record** — `recordOf(writer, epoch)` read from Arc over plain
 *   JSON-RPC from two endpoints that answer, which must agree; the root and the
 *   count must be the ones the receipt states.
 *
 * Read-only: one `eth_chainId` and one `eth_call` per endpoint.
 */

import type { RpcCall } from "./chain.ts";
import { bytesToHex, hexToBytes, keccak256Bytes, keccak256Text } from "./keccak.ts";

const BYTES32 = /^0x[0-9a-f]{64}$/;
const ADDRESS = /^0x[0-9a-f]{40}$/;

/** A receipt's leaf in its epoch's tree. */
export function anchorLeaf(digest: string): `0x${string}` {
  if (!BYTES32.test(digest)) throw new TypeError("a receipt digest is 32 bytes, lowercase hex");
  return bytesToHex(keccak256Bytes(hexToBytes(digest)));
}

const hashPair = (a: string, b: string): `0x${string}` => {
  const [low, high] = a < b ? [a, b] : [b, a];
  const pair = new Uint8Array(64);
  pair.set(hexToBytes(low), 0);
  pair.set(hexToBytes(high), 32);
  return bytesToHex(keccak256Bytes(pair));
};

/** The root a proof leads to from a digest, or null when the proof is not a list of 32-byte hashes. */
export function rootOfProof(digest: string, proof: readonly unknown[]): `0x${string}` | null {
  if (!BYTES32.test(digest) || !proof.every((step) => typeof step === "string" && BYTES32.test(step))) return null;
  return (proof as readonly string[]).reduce<`0x${string}`>((node, sibling) => hashPair(node, sibling), anchorLeaf(digest));
}

/** The root of a whole epoch, from its digests in the order they are listed — what the anchor's `uri` publishes. */
export function epochRoot(digests: readonly string[]): `0x${string}` | null {
  if (digests.length === 0 || !digests.every((d) => BYTES32.test(d)) || new Set(digests).size !== digests.length) return null;
  let level: string[] = digests.map(anchorLeaf);
  while (level.length > 1) {
    const next: string[] = [];
    for (let i = 0; i < level.length; i += 2) next.push(i + 1 < level.length ? hashPair(level[i], level[i + 1]) : level[i]);
    level = next;
  }
  return level[0] as `0x${string}`;
}

/** `recordOf(address,uint64)` */
const RECORD_OF = keccak256Text("recordOf(address,uint64)").slice(0, 10);

export type AnchorRecord = Readonly<{ root: string; count: number; anchoredAt: string }>;

export type AnchorReading =
  | Readonly<{ state: "READ"; record: AnchorRecord; sources: readonly string[] }>
  | Readonly<{ state: "NOT_ANCHORED"; sources: readonly string[] }>
  | Readonly<{ state: "CONFLICT"; detail: string; sources: readonly string[] }>
  | Readonly<{ state: "UNREADABLE"; detail: string }>;

function decodeRecord(raw: unknown): AnchorRecord | "empty" | null {
  if (typeof raw !== "string" || !/^0x[0-9a-fA-F]{192}$/.test(raw)) return null;
  const hex = raw.toLowerCase();
  const root = `0x${hex.slice(2, 66)}`;
  const count = BigInt(`0x${hex.slice(66, 130)}`);
  const anchoredAt = BigInt(`0x${hex.slice(130, 194)}`);
  if (/^0x0{64}$/.test(root)) return "empty";
  if (count >= 1n << 32n || anchoredAt >= 1n << 64n) return null;
  return { root, count: Number(count), anchoredAt: new Date(Number(anchoredAt) * 1000).toISOString().replace(".000Z", "Z") };
}

/**
 * The anchor's record of `writer` for `epoch`, read from the first two endpoints that answer on `chainId`. Two answers
 * that differ are a conflict, never a choice.
 */
export async function readAnchorRecord(args: Readonly<{
  chainId: number;
  anchor: string;
  writer: string;
  epoch: string;
  endpoints: readonly string[];
  call: RpcCall;
  sources?: number;
}>): Promise<AnchorReading> {
  if (!ADDRESS.test(args.anchor) || !ADDRESS.test(args.writer) || !/^(0|[1-9][0-9]*)$/.test(args.epoch) || BigInt(args.epoch) >= 1n << 64n) {
    return { state: "UNREADABLE", detail: "the anchor, the writer or the epoch is malformed" };
  }
  const data = `${RECORD_OF}${args.writer.slice(2).padStart(64, "0")}${BigInt(args.epoch).toString(16).padStart(64, "0")}`;
  const wanted = args.sources ?? 2;
  const answers: { endpoint: string; record: AnchorRecord | "empty" }[] = [];
  const skipped: string[] = [];
  for (const endpoint of args.endpoints) {
    if (answers.length >= wanted) break;
    try {
      const chainId = await args.call(endpoint, "eth_chainId", []);
      if (typeof chainId !== "string" || Number(BigInt(chainId)) !== args.chainId) {
        skipped.push(`${endpoint} serves another chain`);
        continue;
      }
      const decoded = decodeRecord(await args.call(endpoint, "eth_call", [{ to: args.anchor, data }, "latest"]));
      if (decoded === null) {
        skipped.push(`${endpoint} answered with something that is not a record`);
        continue;
      }
      answers.push({ endpoint, record: decoded });
    } catch {
      skipped.push(`${endpoint} could not be read`);
    }
  }
  if (answers.length === 0) return { state: "UNREADABLE", detail: skipped.join("; ") || "no endpoint to read" };
  const sources = answers.map((a) => a.endpoint);
  const spelled = answers.map((a) => JSON.stringify(a.record));
  if (new Set(spelled).size > 1) return { state: "CONFLICT", detail: `${sources.join(" and ")} disagree on the anchor's record`, sources };
  const [first] = answers;
  return first.record === "empty" ? { state: "NOT_ANCHORED", sources } : { state: "READ", record: first.record, sources };
}
