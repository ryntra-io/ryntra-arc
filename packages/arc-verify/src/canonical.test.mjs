/**
 * The canonical serialization and the two seals, proved against an
 * independent SHA-256 over the documented encoding and pinned to literal
 * hashes, so a change in the bytes fails on a number rather than a snapshot.
 */

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { RECEIPT_HASH_DOMAINS, canonicalJson, hashCanonical, hashReceiptCore } from "./canonical.ts";
import { payoutCore, payoutReceipt, swapCore, swapReceipt, transferCore, transferReceipt } from "./test-fixtures.mjs";

const sha256 = (text) => `0x${createHash("sha256").update(text, "utf8").digest("hex")}`;

test("canonical JSON orders keys by code unit at every depth, drops undefined and keeps null", () => {
  assert.equal(canonicalJson({ b: 1, a: { d: null, c: [3, { z: true, y: "é" }] }, e: undefined }), '{"a":{"c":[3,{"y":"é","z":true}],"d":null},"b":1}');
  assert.equal(canonicalJson({ Z: 1, a: 2, _: 3 }), '{"Z":1,"_":3,"a":2}');
  assert.equal(canonicalJson([{ b: 1, a: 2 }, "x"]), '[{"a":2,"b":1},"x"]');
});

test("canonical JSON refuses values that have no one encoding", () => {
  assert.throws(() => canonicalJson({ amount: Number.NaN }));
  assert.throws(() => canonicalJson({ amount: Number.POSITIVE_INFINITY }));
  assert.throws(() => canonicalJson({ at: () => 1 }));
});

test("a 1.0.0 and 1.1.0 receipt hash is SHA-256 over the canonical core, with no domain", () => {
  const core = transferCore();
  assert.equal(hashReceiptCore(core), sha256(canonicalJson(core)));
  assert.equal(hashReceiptCore(core), hashCanonical(core));
  assert.equal(hashReceiptCore({ ...core, schemaVersion: "1.0.0" }), sha256(canonicalJson({ ...core, schemaVersion: "1.0.0" })));
});

test("a payout, an exchange and a crosschain receipt are each hashed under their own domain", () => {
  const payout = payoutCore();
  assert.equal(RECEIPT_HASH_DOMAINS.receipt, "ryntra:payout-receipt:1.2.0");
  assert.equal(hashReceiptCore(payout), sha256(`ryntra:payout-receipt:1.2.0\n${canonicalJson(payout)}`));

  const swap = swapCore();
  assert.equal(hashReceiptCore(swap), sha256(`ryntra:swap-receipt:1.3.0\n${canonicalJson(swap)}`));
  assert.equal(
    hashReceiptCore({ ...swap, schemaVersion: "1.5.0" }),
    sha256(`ryntra:swap-receipt:1.5.0\n${canonicalJson({ ...swap, schemaVersion: "1.5.0" })}`),
  );
  assert.equal(
    hashReceiptCore({ ...swap, schemaVersion: "1.4.0" }),
    sha256(`ryntra:bridge-receipt:1.4.0\n${canonicalJson({ ...swap, schemaVersion: "1.4.0" })}`),
  );
  assert.notEqual(hashReceiptCore(payout), hashCanonical(payout), "the domain changes the hash");
});

test("an unknown schema version is refused rather than hashed under a guess", () => {
  assert.throws(() => hashReceiptCore({ ...payoutCore(), schemaVersion: "9.0.0" }), /Unsupported/);
  assert.throws(() => hashReceiptCore({ schemaVersion: undefined }));
  assert.throws(() => hashReceiptCore(null));
});

test("the integrity hash covers the core and the receipt hash together", () => {
  const receipt = payoutReceipt();
  const { receiptHash, integrity, ...core } = receipt;
  assert.equal(integrity.algorithm, "SHA-256");
  assert.equal(integrity.hash, sha256(canonicalJson({ ...core, receiptHash })));
});

test("the test receipts' seals are pinned literals", () => {
  const pinned = [
    [payoutReceipt(), "0x2fe5401eacb3933995ce53cc7e131f3a3048fbae57de8670a5cbccb98ce6702a", "0xf40ffbd967e8569404e62424d23e0907e0e1eacd656fe14453fac2daac3e722f"],
    [transferReceipt(), "0x71a89c8f0b248db4ce1c3c973a0233dd6f39238f21f589bfcd38fb6667d692d9", "0x6cee6dac288357e467b21e595df5baffa2ba622a16b527b08610353f0cd0565e"],
    [swapReceipt(), "0xd9a02399612d7a208ee81bd065fafa09c26909d983c1b3e4305db079ea68bff8", "0xfbeb45a0cf4446a5ae96bf8878fe9f04feec520ceba1ea583b16fb23e0fb7159"],
  ];
  for (const [receipt, receiptHash, integrityHash] of pinned) {
    assert.equal(receipt.receiptHash, receiptHash, receipt.schemaVersion);
    assert.equal(receipt.integrity.hash, integrityHash, receipt.schemaVersion);
  }
});
