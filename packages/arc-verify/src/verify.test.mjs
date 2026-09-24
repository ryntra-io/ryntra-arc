/**
 * The whole check, end to end, over a fake verifier and a fake Arc endpoint:
 * every path to each of the three verdicts.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { readVerifierAnswer } from "./verifier.ts";
import { verifyReceipt } from "./verify.ts";
import { NOT_FOUND_BODY, PAYOUT_TX, chainWorld, fakeFetch, payoutCore, payoutReceipt, seal, swapReceipt, verifierBody } from "./test-fixtures.mjs";

const VERIFIER = "https://verifier.example/api/arc-verify";
const RPC = "https://rpc.example";

function world({ receipt = payoutReceipt(), body = null, status = 200, chain = chainWorld("PAYOUT"), rpcUp = true } = {}) {
  return fakeFetch({
    worlds: rpcUp ? { [RPC]: chain } : {},
    verifier: { url: VERIFIER, answer: (ref) => ({ status, body: body ?? verifierBody(receipt, ref) }) },
  });
}

const run = (options, fetchWorld = world()) =>
  verifyReceipt({ verifier: VERIFIER, rpc: [RPC], fetchImpl: fetchWorld.impl, ...options });

test("a reference alone: the verifier's seals and Arc's reading confirm the payout", async () => {
  const report = await run({ reference: payoutReceipt().id });
  assert.equal(report.verdict, "CONFIRMED", report.reasons.join(" "));
  assert.deepEqual(report.seal.by, "VERIFIER");
  assert.equal(report.verifier.state, "VERIFIED");
  assert.equal(report.verifier.sameReceipt, null);
  assert.equal(report.kind, "PAYOUT");
  assert.deepEqual(report.network, { id: "arc-testnet", label: "Arc Testnet", chainId: 5042002 });
  assert.equal(report.explorerUrl, `https://testnet.arcscan.app/tx/${PAYOUT_TX}`);
  assert.equal(report.arc.state, "READ");
  assert.equal(report.arc.confirmations, 10);
  assert.equal(report.reasons[0], "The receipt is intact (recomputed by the verifier) and Arc shows the payout it records.");
});

test("the transaction hash is as good a reference as the receipt id", async () => {
  const report = await run({ reference: PAYOUT_TX });
  assert.equal(report.verdict, "CONFIRMED");
  assert.equal(report.reference, PAYOUT_TX);
});

test("the receipt file: seals recomputed here, the verifier holding the same receipt, Arc agreeing", async () => {
  const report = await run({ receipt: payoutReceipt() });
  assert.equal(report.verdict, "CONFIRMED");
  assert.equal(report.seal.by, "THIS_MACHINE");
  assert.equal(report.verifier.sameReceipt, true);
  assert.equal(report.checks.find((check) => check.id === "recipient").status, "MATCH");
});

test("the receipt file with no verifier at all is checked on its own", async () => {
  const fetchWorld = world();
  const report = await run({ receipt: payoutReceipt(), verifier: null }, fetchWorld);
  assert.equal(report.verdict, "CONFIRMED");
  assert.equal(report.verifier.state, "NOT_ASKED");
  assert.equal(fetchWorld.requests.some((url) => url.startsWith(VERIFIER)), false);
});

test("a receipt file changed after sealing is contradicted", async () => {
  const forged = payoutReceipt();
  forged.payout = { ...forged.payout, beneficiaryWalletAddress: `0x${"6".repeat(40)}` };
  const report = await run({ receipt: forged, verifier: null });
  assert.equal(report.verdict, "CONTRADICTED");
  assert.equal(report.seal.state, "BROKEN");
});

test("an intact file that differs from the verifier's copy is contradicted", async () => {
  const other = seal({ ...payoutCore(), finalizedAt: "2026-08-10T12:00:13.000Z" });
  const report = await run({ receipt: payoutReceipt() }, world({ receipt: other }));
  assert.equal(report.seal.state, "INTACT");
  assert.equal(report.verifier.sameReceipt, false);
  assert.equal(report.verdict, "CONTRADICTED");
  assert.match(report.reasons.join(" "), /a different receipt/);
});

test("a verifier reporting its copy tampered is contradicted", async () => {
  const tampered = payoutReceipt();
  tampered.actualEffects = { ...tampered.actualEffects, feeAmount: "0.000001" };
  const report = await run({ reference: tampered.id }, world({ body: verifierBody(tampered) }));
  assert.equal(report.verifier.state, "TAMPERED");
  assert.equal(report.seal.state, "BROKEN");
  assert.equal(report.verdict, "CONTRADICTED");
});

test("Arc showing another amount contradicts an intact receipt", async () => {
  const chain = chainWorld("PAYOUT");
  chain.eth_getTransactionReceipt = {
    ...chain.eth_getTransactionReceipt,
    logs: chain.eth_getTransactionReceipt.logs.map((log) => (log.address === "0x3600000000000000000000000000000000000000" ? { ...log, data: `0x${(900_000).toString(16).padStart(64, "0")}` } : log)),
  };
  const report = await run({ reference: payoutReceipt().id }, world({ chain }));
  assert.equal(report.verdict, "CONTRADICTED");
  assert.match(report.reasons.join(" "), /amount/);
});

test("a reference the verifier does not hold, and no file, is incomplete", async () => {
  const report = await run({ reference: payoutReceipt().id }, world({ body: NOT_FOUND_BODY(payoutReceipt().id) }));
  assert.equal(report.verdict, "INCOMPLETE");
  assert.equal(report.verifier.state, "NOT_FOUND");
  assert.deepEqual(report.reasons, ["The verifier holds no receipt with this reference."]);
});

test("a file the verifier does not hold is still checked on its own", async () => {
  const report = await run({ receipt: payoutReceipt() }, world({ body: NOT_FOUND_BODY(payoutReceipt().id) }));
  assert.equal(report.verdict, "CONFIRMED");
  assert.match(report.notes.join(" "), /holds no receipt with this reference/);
});

test("an Arc that cannot be read leaves an intact receipt incomplete, never confirmed", async () => {
  const report = await run({ reference: payoutReceipt().id }, world({ rpcUp: false }));
  assert.equal(report.arc.state, "UNREADABLE");
  assert.equal(report.verdict, "INCOMPLETE");
  assert.deepEqual(report.arc.skipped, [{ endpoint: RPC, outcome: "UNREACHABLE", detail: "HTTP 403" }]);
});

test("a verifier that refuses or cannot be reached is named, and the verdict is incomplete", async () => {
  let report = await run({ reference: payoutReceipt().id }, world({ status: 429, body: { error: { code: "RATE_LIMITED", message: "x" } } }));
  assert.equal(report.verifier.state, "REFUSED");
  assert.equal(report.verifier.detail, "HTTP 429 RATE_LIMITED");
  assert.equal(report.verdict, "INCOMPLETE");
  report = await verifyReceipt({ reference: payoutReceipt().id, verifier: VERIFIER, rpc: [RPC], fetchImpl: async () => { throw new TypeError("fetch failed"); } });
  assert.equal(report.verifier.state, "UNREACHABLE");
  assert.equal(report.verdict, "INCOMPLETE");
});

test("an exchange receipt is confirmed from its public summary", async () => {
  const receipt = swapReceipt();
  const report = await run({ reference: receipt.id }, world({ receipt, chain: chainWorld("SWAP") }));
  assert.equal(report.verdict, "CONFIRMED", report.reasons.join(" "));
  assert.equal(report.kind, "SWAP");
  assert.equal(report.reasons[0], "The receipt is intact (recomputed by the verifier) and Arc shows the exchange it records.");
});

test("a file that is not a JSON object is not read as a receipt", async () => {
  const report = await run({ receipt: ["not", "a", "receipt"], verifier: null });
  assert.equal(report.verdict, "INCOMPLETE");
  assert.equal(report.seal.state, "UNREADABLE");
});

test("a verifier answer is parsed member by member; a malformed one is not a verdict", () => {
  const body = verifierBody(payoutReceipt());
  assert.equal(readVerifierAnswer(200, body).state, "ANSWERED");
  assert.equal(readVerifierAnswer(200, { data: { ...body.data, verdict: "PROBABLY" } }).state, "INVALID");
  assert.equal(readVerifierAnswer(200, { data: { ...body.data, summary: null } }).state, "INVALID");
  const lying = structuredClone(body);
  lying.data.integrity.receiptHash.recomputed = `0x${"0".repeat(64)}`;
  assert.equal(readVerifierAnswer(200, lying).state, "INVALID", "matches:true over two different hashes");
  assert.deepEqual(readVerifierAnswer(400, { error: { code: "VALIDATION_ERROR" } }), { state: "REFUSED", detail: "HTTP 400 VALIDATION_ERROR" });
});
