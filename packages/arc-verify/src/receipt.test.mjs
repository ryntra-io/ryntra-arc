/**
 * The receipt as a document: references, chain, seals and the public summary.
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  chainRefOf,
  checkSeal,
  normalizeReceiptReference,
  publicSummary,
  receiptKind,
  receiptPrivateValues,
  referencesOf,
} from "./receipt.ts";
import {
  BENEFICIARY,
  BRIDGE_BURN_TX,
  BRIDGE_MINT_TX,
  PAYOUT_TX,
  TREASURY,
  bridgeReceipt,
  payoutReceipt,
  seal,
  swapReceipt,
  transferCore,
  transferReceipt,
} from "./test-fixtures.mjs";

test("an intact receipt of every kind reseals to both recorded hashes", () => {
  for (const receipt of [payoutReceipt(), transferReceipt(), swapReceipt(), bridgeReceipt()]) {
    const outcome = checkSeal(receipt);
    assert.equal(outcome.state, "CHECKED");
    assert.equal(outcome.intact, true, receipt.schemaVersion);
    assert.equal(outcome.report.receiptHash.recomputed, receipt.receiptHash);
    assert.equal(outcome.report.integrityHash.recomputed, receipt.integrity.hash);
    assert.equal(outcome.report.schemaVersion, receipt.schemaVersion);
  }
});

test("changing one amount after sealing breaks the receipt hash", () => {
  const receipt = payoutReceipt();
  receipt.actualEffects = { ...receipt.actualEffects, amountIn: "1.000001" };
  const outcome = checkSeal(receipt);
  assert.equal(outcome.state, "CHECKED");
  assert.equal(outcome.intact, false);
  assert.equal(outcome.report.receiptHash.matches, false);
});

test("changing the recorded receipt hash breaks the integrity hash that covers it", () => {
  const original = payoutReceipt();
  const forged = { ...original, receiptHash: seal({ ...transferCore() }).receiptHash };
  const outcome = checkSeal(forged);
  assert.equal(outcome.intact, false);
  assert.equal(outcome.report.receiptHash.matches, false);
  assert.equal(outcome.report.integrityHash.matches, false);
});

test("a record whose seals cannot be computed is uninterpretable, not tampered and not intact", () => {
  const { integrity: _integrity, ...unsealed } = payoutReceipt();
  assert.deepEqual(checkSeal(unsealed), { state: "UNINTERPRETABLE", reason: "MISSING_OR_MALFORMED_INTEGRITY_BLOCK" });
  assert.deepEqual(checkSeal({ ...payoutReceipt(), integrity: { algorithm: "MD5", hash: payoutReceipt().integrity.hash } }).state, "UNINTERPRETABLE");
  assert.deepEqual(checkSeal({ ...payoutReceipt(), schemaVersion: "9.0.0" }), { state: "UNINTERPRETABLE", reason: "RECORD_IS_NOT_CANONICALLY_HASHABLE" });
});

test("a receipt answers to its id, its operation, both seals and its transaction", () => {
  const receipt = payoutReceipt();
  assert.deepEqual(referencesOf(receipt), [receipt.id, receipt.intent.id, receipt.receiptHash, receipt.integrity.hash, PAYOUT_TX]);
});

test("a transfer across networks answers to its burn and to its delivery, each once", () => {
  const receipt = bridgeReceipt();
  assert.deepEqual(referencesOf(receipt), [receipt.id, receipt.receiptHash, receipt.integrity.hash, BRIDGE_MINT_TX, BRIDGE_BURN_TX]);
  /* The anchor is the mint on Arc: Arc's chain, read from the receipt. */
  assert.equal(chainRefOf(receipt), "eip155:5042002");
  const tampered = bridgeReceipt();
  tampered.bridge = { ...tampered.bridge, amounts: { ...tampered.bridge.amounts, received: "4.990000" } };
  assert.equal(checkSeal(tampered).intact, false);
});

test("a reference is normalized, and anything that cannot be one is refused before any lookup", () => {
  assert.equal(normalizeReceiptReference("  RCP_0000000000000000000000000000000A \n"), "rcp_0000000000000000000000000000000a");
  assert.equal(normalizeReceiptReference(PAYOUT_TX.toUpperCase().replace("0X", "0x")), PAYOUT_TX);
  for (const bad of ["", "nonsense", "rcp_short", "0x1234", `0x${"g".repeat(64)}`, `rcp_${"a".repeat(200)}`, null, undefined]) {
    assert.equal(normalizeReceiptReference(bad), null, String(bad));
  }
});

test("the chain is read from the receipt itself, never assumed", () => {
  assert.equal(chainRefOf(payoutReceipt()), "eip155:5042002");
  assert.equal(chainRefOf(transferReceipt()), "eip155:5042002");
  const receipt = transferReceipt();
  receipt.reconciliation = { ...receipt.reconciliation, evidence: { ...receipt.reconciliation.evidence, sourceRef: "https://rpc.example" } };
  assert.equal(chainRefOf(receipt), null);
});

test("the kind comes from the schema version and the block together", () => {
  assert.equal(receiptKind(payoutReceipt()), "PAYOUT");
  assert.equal(receiptKind(transferReceipt()), "TRANSFER");
  assert.equal(receiptKind(swapReceipt()), "SWAP");
  assert.equal(receiptKind(bridgeReceipt()), "BRIDGE");
  const { bridge: _bridge, ...bridgeWithoutBlock } = bridgeReceipt();
  assert.equal(receiptKind(bridgeWithoutBlock), "UNKNOWN");
  const { payout: _payout, ...withoutBlock } = payoutReceipt();
  assert.equal(receiptKind(withoutBlock), "UNKNOWN");
});

test("the public summary names no tenant, principal, evidence item or wallet", () => {
  for (const receipt of [payoutReceipt(), transferReceipt(), swapReceipt(), bridgeReceipt()]) {
    const serialized = JSON.stringify(publicSummary(receipt));
    for (const secret of receiptPrivateValues(receipt)) assert.equal(serialized.includes(secret), false, secret);
    assert.equal(serialized.toLowerCase().includes(TREASURY), false);
    assert.equal(serialized.toLowerCase().includes(BENEFICIARY), false);
  }
});

test("the public summary of a payout carries its amounts, approvals, ceiling and block", () => {
  const summary = publicSummary(payoutReceipt());
  assert.equal(summary.kind, "PAYOUT");
  assert.deepEqual(summary.detail, {
    purposeCode: "INVOICE",
    amount: "1.000000",
    requiredApprovalCount: 1,
    receivedApprovalCount: 1,
    maxTotalDebit: "1010000",
    actualTotalDebit: "1001234",
    confirmations: 1,
    blockNumber: 1000,
  });
  assert.equal(summary.chainRef, "eip155:5042002");
  assert.equal(summary.transactionHash, PAYOUT_TX);
  assert.equal(summary.feeAmount, "0.001234");
  assert.equal(summary.authorizationMethod, "PARTNER_AUTHENTICATED");
});

test("the public summary of a transfer into Arc carries both transactions, the route and the three amounts", () => {
  const summary = publicSummary(bridgeReceipt());
  assert.equal(summary.kind, "BRIDGE");
  assert.equal(summary.transactionHash, BRIDGE_MINT_TX);
  assert.equal(summary.amountIn, "5.000000");
  assert.equal(summary.amountOut, "4.985000");
  assert.equal(summary.feeAmount, "0.015000");
  assert.equal(summary.detail.direction, "INTO_ARC");
  assert.equal(summary.detail.asset, "USDC");
  assert.equal(summary.detail.sourceLabel, "Base Sepolia");
  assert.equal(summary.detail.destinationLabel, "Arc");
  assert.equal(summary.detail.sourceTransactionHash, BRIDGE_BURN_TX);
  assert.equal(summary.detail.destinationTransactionHash, BRIDGE_MINT_TX);
  assert.equal(summary.detail.deliveredBy, "CIRCLE_FORWARDING_SERVICE");
  assert.equal(summary.detail.sourceExplorerUrl, `https://sepolia.basescan.org/tx/${BRIDGE_BURN_TX}`);
  assert.deepEqual(summary.detail.deviations, []);
});
