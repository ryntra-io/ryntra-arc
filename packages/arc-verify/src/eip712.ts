/**
 * The EIP-712 form of a Ryntra engine receipt (receipt 2.0.0).
 *
 * One definition for both sides: Ryntra signs its receipts with these types,
 * imported from this file, and this package checks them with the same — a verifier with its own copy of the
 * types would be checking its copy.
 *
 * ```text
 * EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)
 *   name "Ryntra Receipt" · version "2" · chainId — the Arc network the action ran on
 *   verifyingContract — Ryntra's ReceiptAnchor on that network, where the receipt's epoch is anchored
 *
 * Receipt(bytes32 operationId,string action,address target,address executor,bytes32 transactionHash,
 *         uint64 blockNumber,bytes32 constitution,bytes32 record,uint64 issuedAt)
 * ```
 *
 * `record` is the receipt's own SHA-256 seal (`receiptHash`) over everything
 * the receipt states — the Flight Log's five fields included — so the
 * signature binds the whole document while a wallet or a reader still sees the
 * operation, the action, the contract, the transaction and the time in plain
 * fields. `constitution` is the SHA-256 of the constitution the action was
 * done under, or zero when none asked for it. The digest is also the receipt's
 * leaf in its epoch's tree (`ReceiptAnchor`, `anchor.ts`).
 *
 * Pure: no clock, no network.
 */

import { bytesToHex, hexToBytes, keccak256Bytes, keccak256Text } from "./keccak.ts";

export const RECEIPT_EIP712_NAME = "Ryntra Receipt";
export const RECEIPT_EIP712_VERSION = "2";
export const RECEIPT_PRIMARY_TYPE = "Receipt";

export const RECEIPT_EIP712_TYPES = {
  EIP712Domain: [
    { name: "name", type: "string" },
    { name: "version", type: "string" },
    { name: "chainId", type: "uint256" },
    { name: "verifyingContract", type: "address" },
  ],
  Receipt: [
    { name: "operationId", type: "bytes32" },
    { name: "action", type: "string" },
    { name: "target", type: "address" },
    { name: "executor", type: "address" },
    { name: "transactionHash", type: "bytes32" },
    { name: "blockNumber", type: "uint64" },
    { name: "constitution", type: "bytes32" },
    { name: "record", type: "bytes32" },
    { name: "issuedAt", type: "uint64" },
  ],
} as const;

const DOMAIN_TYPE = "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)";
const RECEIPT_TYPE =
  "Receipt(bytes32 operationId,string action,address target,address executor,bytes32 transactionHash,uint64 blockNumber,bytes32 constitution,bytes32 record,uint64 issuedAt)";

export type Hex32 = `0x${string}`;

/** Where a receipt is valid: the network and the anchor it names. */
export type ReceiptDomain = Readonly<{ chainId: number; verifyingContract: string }>;

/** The signed fields. Numbers travel as decimal strings: a receipt is JSON. */
export type ReceiptMessage = Readonly<{
  operationId: string;
  action: string;
  target: string;
  executor: string;
  transactionHash: string;
  blockNumber: string;
  constitution: string;
  record: string;
  issuedAt: string;
}>;

export class ReceiptTypeError extends TypeError {}

const BYTES32 = /^0x[0-9a-f]{64}$/;
const ADDRESS = /^0x[0-9a-f]{40}$/;
const DECIMAL = /^(0|[1-9][0-9]*)$/;
const UINT64_MAX = (1n << 64n) - 1n;

function bytes32(name: string, value: unknown): Uint8Array {
  if (typeof value !== "string" || !BYTES32.test(value)) throw new ReceiptTypeError(`${name} is 32 bytes, lowercase hex`);
  return hexToBytes(value);
}

function address(name: string, value: unknown): Uint8Array {
  if (typeof value !== "string" || !ADDRESS.test(value)) throw new ReceiptTypeError(`${name} is an address, lowercase hex`);
  const out = new Uint8Array(32);
  out.set(hexToBytes(value), 12);
  return out;
}

function uint(name: string, value: unknown, max: bigint): Uint8Array {
  const text = typeof value === "number" && Number.isSafeInteger(value) ? String(value) : value;
  if (typeof text !== "string" || !DECIMAL.test(text) || BigInt(text) > max) throw new ReceiptTypeError(`${name} is a whole number that fits its type`);
  return hexToBytes(`0x${BigInt(text).toString(16).padStart(64, "0")}`);
}

function string(name: string, value: unknown): Uint8Array {
  if (typeof value !== "string" || value.length === 0) throw new ReceiptTypeError(`${name} is a non-empty string`);
  return hexToBytes(keccak256Text(value));
}

const concat = (parts: readonly Uint8Array[]): Uint8Array => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
};

/** The domain separator of a receipt's network and anchor. */
export function receiptDomainSeparator(domain: ReceiptDomain): Hex32 {
  return bytesToHex(
    keccak256Bytes(
      concat([
        hexToBytes(keccak256Text(DOMAIN_TYPE)),
        hexToBytes(keccak256Text(RECEIPT_EIP712_NAME)),
        hexToBytes(keccak256Text(RECEIPT_EIP712_VERSION)),
        uint("chainId", domain.chainId, (1n << 256n) - 1n),
        address("verifyingContract", domain.verifyingContract),
      ]),
    ),
  );
}

/** `hashStruct(Receipt)`. Throws on a field of the wrong shape: a malformed receipt is never hashed under a guess. */
export function receiptStructHash(message: ReceiptMessage): Hex32 {
  return bytesToHex(
    keccak256Bytes(
      concat([
        hexToBytes(keccak256Text(RECEIPT_TYPE)),
        bytes32("operationId", message.operationId),
        string("action", message.action),
        address("target", message.target),
        address("executor", message.executor),
        bytes32("transactionHash", message.transactionHash),
        uint("blockNumber", message.blockNumber, UINT64_MAX),
        bytes32("constitution", message.constitution),
        bytes32("record", message.record),
        uint("issuedAt", message.issuedAt, UINT64_MAX),
      ]),
    ),
  );
}

/** The EIP-712 digest a receipt signer signs: keccak256(0x1901 ‖ domainSeparator ‖ hashStruct(message)). */
export function receiptDigest(domain: ReceiptDomain, message: ReceiptMessage): Hex32 {
  return bytesToHex(
    keccak256Bytes(concat([Uint8Array.of(0x19, 0x01), hexToBytes(receiptDomainSeparator(domain)), hexToBytes(receiptStructHash(message))])),
  );
}

/** The typed data as a wallet or a signing service reads it (EIP-712 JSON, version 4). */
export function receiptTypedData(domain: ReceiptDomain, message: ReceiptMessage) {
  return {
    types: RECEIPT_EIP712_TYPES,
    primaryType: RECEIPT_PRIMARY_TYPE,
    domain: { name: RECEIPT_EIP712_NAME, version: RECEIPT_EIP712_VERSION, chainId: domain.chainId, verifyingContract: domain.verifyingContract },
    message,
  } as const;
}
