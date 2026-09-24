/**
 * A receipt held against one reading of its transaction: each kind confirmed,
 * then each fact contradicted in turn.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { readArcTransaction } from "./chain.ts";
import {
  ceilToSixDecimals,
  checkAgainstArc,
  factsFromReceipt,
  factsFromSummary,
  fromBaseUnits,
  isExchangeShaped,
  toBaseUnits,
} from "./check.ts";
import { ARC_TESTNET_NETWORK } from "./networks.ts";
import { publicSummary } from "./receipt.ts";
import { BENEFICIARY, TREASURY, USDC, chainWorld, fakeRpc, payoutReceipt, seal, swapCore, swapReceipt, transferCore, transferReceipt } from "./test-fixtures.mjs";

const ENDPOINT = "https://rpc.example";

async function readingOf(world) {
  const tx = world.eth_getTransactionReceipt.transactionHash;
  const outcome = await readArcTransaction({ network: ARC_TESTNET_NETWORK, transactionHash: tx, endpoints: [ENDPOINT], call: fakeRpc({ [ENDPOINT]: world }).call });
  assert.equal(outcome.state, "READ", JSON.stringify(outcome.notes));
  return outcome.readings[0];
}

const byId = (checks) => Object.fromEntries(checks.map((check) => [check.id, check]));
const statuses = (checks) => Object.fromEntries(checks.map((check) => [check.id, check.status]));

/** A payout world whose USDC Transfer is rewritten by `edit`. */
function payoutWorldWith(edit) {
  const world = chainWorld("PAYOUT");
  world.eth_getTransactionReceipt = {
    ...world.eth_getTransactionReceipt,
    logs: world.eth_getTransactionReceipt.logs.map((log) => (log.address === USDC ? edit(log) : log)),
  };
  return world;
}

test("a payout receipt, read from its file, matches every fact Arc shows", async () => {
  const checks = checkAgainstArc(factsFromReceipt(payoutReceipt()), await readingOf(chainWorld("PAYOUT")), ARC_TESTNET_NETWORK);
  assert.deepEqual(statuses(checks), {
    chain: "MATCH",
    status: "MATCH",
    contract: "MATCH",
    value: "MATCH",
    transfers: "MATCH",
    amount: "MATCH",
    sender: "MATCH",
    treasury: "MATCH",
    recipient: "MATCH",
    block: "MATCH",
    debit: "MATCH",
    "usdc-decimals": "MATCH",
    fee: "MATCH",
    time: "MATCH",
  });
  const detail = byId(checks);
  assert.equal(detail.fee.detail, "the network fee was 0.00123354 USDC (48950 gas at 25.2 gwei); recorded as 0.001234, rounded up to 6 decimals");
  assert.equal(detail.debit.detail, "1.001234 USDC left the treasury with the fee, as recorded, within the approved ceiling of 1.010000");
  assert.equal(detail.block.detail, "in block 1000, with the recorded block hash, position in the block, event index");
});

test("from the public summary, a payout matches everything except the wallets, which it does not name", async () => {
  const facts = factsFromSummary(publicSummary(payoutReceipt()));
  const checks = checkAgainstArc(facts, await readingOf(chainWorld("PAYOUT")), ARC_TESTNET_NETWORK);
  const status = statuses(checks);
  assert.equal(status.treasury, "NOT_RECORDED");
  assert.equal(status.recipient, "NOT_RECORDED");
  assert.equal(Object.values(status).includes("MISMATCH"), false);
  const text = JSON.stringify(checks).toLowerCase();
  assert.equal(text.includes(TREASURY), false);
  assert.equal(text.includes(BENEFICIARY), false);
});

test("a payout to another wallet, of another amount, or with two transfers is contradicted", async () => {
  const facts = factsFromReceipt(payoutReceipt());
  const stranger = `0x${"5".repeat(40)}`;
  let checks = statuses(checkAgainstArc(facts, await readingOf(payoutWorldWith((log) => ({ ...log, topics: [log.topics[0], log.topics[1], `0x${stranger.slice(2).padStart(64, "0")}`] }))), ARC_TESTNET_NETWORK));
  assert.equal(checks.recipient, "MISMATCH");

  checks = statuses(checkAgainstArc(facts, await readingOf(payoutWorldWith((log) => ({ ...log, data: `0x${(1_000_001).toString(16).padStart(64, "0")}` }))), ARC_TESTNET_NETWORK));
  assert.equal(checks.amount, "MISMATCH");
  assert.equal(checks.debit, "MISMATCH");

  const doubled = chainWorld("PAYOUT");
  const usdcLog = doubled.eth_getTransactionReceipt.logs.find((log) => log.address === USDC);
  doubled.eth_getTransactionReceipt = { ...doubled.eth_getTransactionReceipt, logs: [...doubled.eth_getTransactionReceipt.logs, { ...usdcLog, logIndex: "0x30" }] };
  checks = statuses(checkAgainstArc(facts, await readingOf(doubled), ARC_TESTNET_NETWORK));
  assert.equal(checks.transfers, "MISMATCH");
});

test("Arc's native mirror of each USDC movement is not counted as a second transfer", async () => {
  const reading = await readingOf(chainWorld("PAYOUT"));
  assert.equal(reading.transfers.length, 2, "the fixture carries the mirror event");
  assert.equal(byId(checkAgainstArc(factsFromReceipt(payoutReceipt()), reading, ARC_TESTNET_NETWORK)).transfers.status, "MATCH");
});

test("a reverted transaction, a fee rounded down, a late block or the wrong block is contradicted", async () => {
  const facts = factsFromReceipt(payoutReceipt());

  const reverted = chainWorld("PAYOUT");
  reverted.eth_getTransactionReceipt = { ...reverted.eth_getTransactionReceipt, status: "0x0" };
  assert.equal(statuses(checkAgainstArc(facts, await readingOf(reverted), ARC_TESTNET_NETWORK)).status, "MISMATCH");

  const roundedDown = { ...facts, feeAmount: "0.001233" };
  assert.equal(statuses(checkAgainstArc(roundedDown, await readingOf(chainWorld("PAYOUT")), ARC_TESTNET_NETWORK)).fee, "MISMATCH");

  const late = chainWorld("PAYOUT");
  late.eth_getBlockByNumber = { ...late.eth_getBlockByNumber, timestamp: `0x${(Date.parse("2026-08-10T12:00:13.000Z") / 1000).toString(16)}` };
  assert.equal(statuses(checkAgainstArc(facts, await readingOf(late), ARC_TESTNET_NETWORK)).time, "MISMATCH");

  const otherBlock = { ...facts, payout: { ...facts.payout, blockNumber: 999 } };
  assert.equal(statuses(checkAgainstArc(otherBlock, await readingOf(chainWorld("PAYOUT")), ARC_TESTNET_NETWORK)).block, "MISMATCH");

  const otherIndex = { ...facts, payout: { ...facts.payout, logIndex: 12 } };
  assert.equal(statuses(checkAgainstArc(otherIndex, await readingOf(chainWorld("PAYOUT")), ARC_TESTNET_NETWORK)).block, "MISMATCH");
});

test("a transfer receipt matches its one USDC Transfer and says it does not record the recipient", async () => {
  const checks = checkAgainstArc(factsFromReceipt(transferReceipt()), await readingOf(chainWorld("TRANSFER")), ARC_TESTNET_NETWORK);
  const status = statuses(checks);
  assert.equal(status.transfers, "MATCH");
  assert.equal(status.amount, "MATCH");
  assert.equal(status.sender, "MATCH");
  assert.equal(status.recipient, "NOT_RECORDED");
  assert.equal(byId(checks).fee.detail, "the network fee was 0.00153083895 USDC (73950 gas at 20.701 gwei), exactly as recorded");
  assert.equal(Object.values(status).includes("MISMATCH"), false);
});

test("an exchange receipt matches what left and what arrived in the signing wallet", async () => {
  const checks = checkAgainstArc(factsFromReceipt(swapReceipt()), await readingOf(chainWorld("SWAP")), ARC_TESTNET_NETWORK);
  const status = statuses(checks);
  assert.equal(status.sold, "MATCH");
  assert.equal(status.bought, "MATCH");
  assert.equal(status.minimum, "MATCH");
  assert.equal(status["usdc-decimals"], "MATCH");
  assert.equal(status["eurc-decimals"], "MATCH");
  assert.equal(status.fee, "MATCH");
  assert.equal(byId(checks).sold.detail, "3.000000 USDC left the signing wallet, as recorded (3.000000)");
  assert.equal(byId(checks).bought.detail, "2.651611 EURC arrived in the signing wallet, as recorded (2.651611)");
});

test("an exchange that delivered less than recorded, or below the approved minimum, is contradicted", async () => {
  const facts = factsFromReceipt(seal({ ...swapCore(), actualEffects: { ...swapCore().actualEffects, amountOut: "2.700000" } }));
  const status = statuses(checkAgainstArc(facts, await readingOf(chainWorld("SWAP")), ARC_TESTNET_NETWORK));
  assert.equal(status.bought, "MISMATCH");
  const floor = { ...factsFromReceipt(swapReceipt()), minimumAmountOut: "2.700000" };
  assert.equal(statuses(checkAgainstArc(floor, await readingOf(chainWorld("SWAP")), ARC_TESTNET_NETWORK)).minimum, "MISMATCH");
});

test("a transfer-schema receipt whose amounts describe an exchange is checked as the exchange", async () => {
  const core = transferCore();
  const exchange = seal({ ...core, actualEffects: { amountIn: "3", amountOut: "2.651611", feeAmount: "0.0162269856" }, reconciliation: { ...core.reconciliation, actual: { amountIn: "3", amountOut: "2.651611", feeAmount: "0.0162269856" } } });
  const facts = factsFromReceipt(exchange);
  assert.equal(facts.kind, "TRANSFER");
  assert.equal(isExchangeShaped(facts), true);
  const status = statuses(checkAgainstArc(facts, await readingOf(chainWorld("SWAP")), ARC_TESTNET_NETWORK));
  assert.equal(status.sold, "MATCH");
  assert.equal(status.bought, "MATCH");
  assert.equal(status.transfers, undefined);
});

test("a kind this package does not read back yields no checks at all", async () => {
  const facts = { ...factsFromReceipt(payoutReceipt()), kind: "BRIDGE" };
  assert.deepEqual(checkAgainstArc(facts, await readingOf(chainWorld("PAYOUT")), ARC_TESTNET_NETWORK), []);
});

test("decimal strings convert to base units exactly, and never through a float", () => {
  assert.equal(toBaseUnits("1.000000", 6), 1_000_000n);
  assert.equal(toBaseUnits("3", 6), 3_000_000n);
  assert.equal(toBaseUnits("0.00153083895", 18), 1_530_838_950_000_000n);
  assert.equal(toBaseUnits("0.1234567", 6), null, "more decimals than the unit has");
  assert.equal(toBaseUnits("0.1234560", 6), 123_456n, "trailing zeros beyond the unit are exact");
  for (const bad of ["-1", "1e6", "01", ".5", "1.", "", null]) assert.equal(toBaseUnits(bad, 6), null, String(bad));
  assert.equal(fromBaseUnits(1_001_234n, 6), "1.001234");
  assert.equal(fromBaseUnits(1_233_540_000_000_000n, 18, false), "0.00123354");
  assert.equal(fromBaseUnits(25_200_000_000n, 9, false), "25.2");
  assert.equal(ceilToSixDecimals(1_233_540_000_000_000n), 1_234n);
  assert.equal(ceilToSixDecimals(1_234_000_000_000_000n), 1_234n, "an exact amount is not rounded");
});
