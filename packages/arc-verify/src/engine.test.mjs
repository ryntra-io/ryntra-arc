/**
 * A receipt of what Ryntra's executor did (2.0.0): the hash, the signature, the keys, the transaction and the
 * anchor — each checked on its own, every verdict reached. Network-free: the chain is a stand-in that answers
 * JSON-RPC as an Arc node does; the receipt was made and signed by the product's own code with a key thrown away
 * (`fixtures/engine-receipt.json`).
 */

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { anchorLeaf, epochRoot, rootOfProof } from "./anchor.ts";
import { receiptDigest } from "./eip712.ts";
import { checkEngineReceipt, publicEngineView, signedParts } from "./engine.ts";
import { keccak256Hex, keccak256Text } from "./keccak.ts";
import { keyTrust, parseRegistry } from "./keys.ts";
import { checkSeal, referencesOf } from "./receipt.ts";
import { parseSignature, recoverAddress } from "./secp256k1.ts";
import { verifyReceipt } from "./verify.ts";

const fixture = JSON.parse(await readFile(new URL("./fixtures/engine-receipt.json", import.meta.url), "utf8"));
const copy = (value) => JSON.parse(JSON.stringify(value));
const N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
const RPC = "https://rpc.stand-in.test";

/** An Arc node over `fetch`: the fixture's transaction and the anchor's record, or what a test changes of them. */
function arcNode(chain = fixture.chain) {
  return async (_url, init) => {
    const { id, method, params } = JSON.parse(init.body);
    const results = {
      eth_chainId: chain.chainId,
      eth_blockNumber: chain.head,
      eth_getTransactionReceipt: params?.[0] === chain.receipt.transactionHash ? chain.receipt : null,
      eth_getTransactionByHash: params?.[0] === chain.transaction.hash ? chain.transaction : null,
      eth_getBlockByNumber: chain.block,
      eth_call: chain.anchorRecord,
    };
    return new Response(JSON.stringify({ jsonrpc: "2.0", id, result: results[method] ?? null }), { headers: { "content-type": "application/json" } });
  };
}

const check = (overrides = {}) =>
  verifyReceipt({ receipt: overrides.receipt ?? fixture.receipt, verifier: null, rpc: [RPC], fetchImpl: arcNode(overrides.chain), registry: "registry" in overrides ? overrides.registry : fixture.registry });

test("keccak-256 and ecrecover are Ethereum's: published vectors", () => {
  assert.equal(keccak256Text(""), "0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470");
  assert.equal(keccak256Text("abc"), "0x4e03657aea45a94fc7d47ba826c8d667c0d1e6e33a64a036ec44f58fa12d6c45");
  assert.equal(keccak256Text("Transfer(address,address,uint256)"), "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef");
  assert.equal(keccak256Hex(`0x${"00".repeat(200)}`), keccak256Hex(`0x${"00".repeat(200)}`));
  /* The signature of the fixture recovers to its signer; its high-s twin is refused, not a second valid copy. */
  const { digest, value, signer } = fixture.receipt.signature;
  assert.equal(recoverAddress(digest, value), signer);
  const parts = parseSignature(value);
  const twin = `0x${value.slice(2, 66)}${(N - parts.s).toString(16).padStart(64, "0")}${parts.yParity ? "1b" : "1c"}`;
  assert.equal(parseSignature(twin), null);
  assert.equal(recoverAddress(digest, twin), null);
  assert.equal(recoverAddress(digest, `${value.slice(0, 130)}1d`), null, "v is 27 or 28 (or 0 or 1)");
  assert.notEqual(recoverAddress(`0x${"11".repeat(32)}`, value), signer, "another digest, another signer");
});

test("the receipt's seals, its EIP-712 digest and its references", () => {
  const seal = checkSeal(fixture.receipt);
  assert.equal(seal.state, "CHECKED");
  assert.equal(seal.intact, true, "signature and anchor sit beside the seals");
  const parts = signedParts(fixture.receipt);
  assert.equal(receiptDigest(parts.domain, parts.message), fixture.receipt.signature.digest);
  assert.equal(parts.message.record, fixture.receipt.receiptHash);
  const refs = referencesOf(fixture.receipt);
  for (const ref of [fixture.receipt.id, fixture.receipt.operationId, fixture.receipt.signature.digest, fixture.receipt.proof.transactionHash]) assert.ok(refs.includes(ref), ref);
  const changed = copy(fixture.receipt);
  changed.flight.why = "something else";
  assert.equal(checkSeal(changed).intact, false);
});

test("the anchor's tree: a leaf hashes 32 bytes, pairs sorted — the epoch's root from its proof and from its list", () => {
  const { anchor, signature } = fixture.receipt;
  assert.equal(rootOfProof(signature.digest, anchor.proof), anchor.root);
  assert.equal(epochRoot([signature.digest, `0x${"0d".repeat(32)}`]), anchor.root);
  assert.equal(anchorLeaf(signature.digest), keccak256Hex(signature.digest));
  assert.equal(rootOfProof(signature.digest, ["not a hash"]), null);
});

test("signed by Ryntra's receipt key, sent by its executor, anchored in its hour: CONFIRMED", async () => {
  const report = await check();
  assert.equal(report.verdict, "CONFIRMED", report.reasons.join(" "));
  assert.equal(report.kind, "ENGINE");
  assert.deepEqual(report.checks.map((c) => [c.id, c.status]), [
    ["signature", "MATCH"],
    ["receipt-key", "MATCH"],
    ["anchor-contract", "MATCH"],
    ["transaction", "MATCH"],
    ["executor-key", "MATCH"],
    ["reconciliation", "MATCH"],
    ["anchor", "MATCH"],
    ["anchor-writer", "MATCH"],
  ]);
  assert.equal(report.seal.by, "THIS_MACHINE");
});

test("a key the verifier does not know is not a success, and a key the registry names otherwise is a contradiction", async () => {
  const empty = { schema: "ryntra.arc-registry/1", contracts: [], splits: [], keys: [] };
  const unknown = await check({ registry: empty });
  assert.equal(unknown.verdict, "INCOMPLETE");
  assert.equal(unknown.checks.find((c) => c.id === "receipt-key").status, "NOT_RECORDED");
  const other = copy(fixture.registry);
  other.keys[1].address = `0x${"9".repeat(40)}`;
  const contradicted = await check({ registry: other });
  assert.equal(contradicted.verdict, "CONTRADICTED");
  assert.equal(contradicted.checks.find((c) => c.id === "receipt-key").status, "MISMATCH");
  const revoked = copy(fixture.registry);
  revoked.keys[1].revokedAt = "2026-10-11T09:00:00Z";
  assert.equal((await check({ registry: revoked })).verdict, "CONTRADICTED", "signed after its key was revoked");
});

test("not anchored yet: INCOMPLETE — and an anchor the chain does not hold is a contradiction", async () => {
  const { anchor: _anchor, ...unanchored } = fixture.receipt;
  const pending = await check({ receipt: unanchored });
  assert.equal(pending.verdict, "INCOMPLETE");
  assert.match(pending.checks.find((c) => c.id === "anchor").detail, /not anchored yet/);
  const elsewhere = await check({ chain: { ...fixture.chain, anchorRecord: `0x${"ab".repeat(32)}${"0".repeat(63)}2${"0".repeat(56)}6a0a0000` } });
  assert.equal(elsewhere.verdict, "CONTRADICTED");
  const nothing = await check({ chain: { ...fixture.chain, anchorRecord: `0x${"0".repeat(192)}` } });
  assert.equal(nothing.verdict, "CONTRADICTED");
  const proof = copy(fixture.receipt);
  proof.anchor.proof = [`0x${"ee".repeat(32)}`];
  assert.equal((await check({ receipt: proof })).verdict, "CONTRADICTED", "a proof that leads elsewhere");
  const hour = copy(fixture.receipt);
  hour.anchor.epoch = String(Number(hour.anchor.epoch) + 1);
  assert.equal((await check({ receipt: hour })).verdict, "CONTRADICTED", "anchored in another hour than it was signed");
});

test("a transaction that says otherwise, or a signature that is not the signer's: CONTRADICTED", async () => {
  const sender = await check({ chain: { ...fixture.chain, transaction: { ...fixture.chain.transaction, from: `0x${"8".repeat(40)}` } } });
  assert.equal(sender.verdict, "CONTRADICTED");
  assert.match(sender.checks.find((c) => c.id === "transaction").detail, /sent by/);
  const reverted = await check({ chain: { ...fixture.chain, receipt: { ...fixture.chain.receipt, status: "0x0" } } });
  assert.equal(reverted.verdict, "CONTRADICTED");
  const forged = copy(fixture.receipt);
  forged.signature.signer = `0x${"9".repeat(40)}`;
  assert.equal((await check({ receipt: forged })).verdict, "CONTRADICTED");
  const renamed = copy(fixture.receipt);
  renamed.proof.executor = `0x${"8".repeat(40)}`;
  const broken = await check({ receipt: renamed });
  assert.equal(broken.verdict, "CONTRADICTED", "the seal breaks before anything else");
  assert.equal(broken.seal.state, "BROKEN");
});

test("the public view carries what a stranger checks with, and not a treasury's why or counterparties", async () => {
  const view = publicEngineView(fixture.receipt);
  const text = JSON.stringify(view);
  assert.ok(!text.includes(fixture.receipt.flight.why));
  assert.ok(!text.includes(fixture.receipt.action.fields.recipient));
  assert.ok(!text.includes(fixture.receipt.action.fields.account));
  const parts = signedParts(view);
  assert.equal(receiptDigest(parts.domain, parts.message), fixture.receipt.signature.digest, "the view alone rebuilds the signed digest");
});

test("a registry handed in is read only in its own shape and only if it keeps the registry's rules", () => {
  assert.equal(typeof parseRegistry(fixture.registry), "object");
  assert.equal(typeof parseRegistry({ ryntra: fixture.registry }), "object", "as /api/arc-registry serves it");
  assert.match(parseRegistry({ schema: "x" }), /not a ryntra.arc-registry\/1 record/);
  const twice = copy(fixture.registry);
  twice.keys.push({ ...twice.keys[1], id: "fixture-receipts-2" });
  assert.match(parseRegistry(twice), /breaks the registry's rules/);
  assert.equal(keyTrust(fixture.registry, "receipt-signer", 5042, fixture.receipt.signature.signer, Date.parse("2026-10-11T00:00:00Z")).state, "UNKNOWN", "a stand key is no mainnet key");
});

test("a file saved before its hour was anchored is the same receipt the verifier now serves with its anchor: CONFIRMED", async () => {
  const VERIFIER = "https://verifier.stand-in.test/api/arc-verify";
  const answer = (served) => ({ data: { verdict: "VERIFIED", receiptRef: served.id, kind: "ENGINE", summary: publicEngineView(served), integrity: checkSeal(served).report } });
  const both = (served) => {
    const node = arcNode();
    return async (url, init) => (String(url).startsWith(VERIFIER) ? new Response(JSON.stringify(answer(served)), { headers: { "content-type": "application/json" } }) : node(url, init));
  };
  const { anchor: _anchor, ...early } = fixture.receipt;
  const report = await verifyReceipt({ receipt: early, verifier: VERIFIER, rpc: [RPC], fetchImpl: both(fixture.receipt), registry: fixture.registry });
  assert.equal(report.verifier.sameReceipt, true);
  assert.equal(report.verdict, "CONFIRMED", report.reasons.join(" "));
  assert.ok(report.notes.some((n) => /saved before its hour was anchored/.test(n)));
  /* And the other way: a file with its anchor, a verifier that serves none — the same receipt, its anchor checked on Arc. */
  const { anchor: _a, ...unanchored } = fixture.receipt;
  const other = await verifyReceipt({ receipt: fixture.receipt, verifier: VERIFIER, rpc: [RPC], fetchImpl: both(unanchored), registry: fixture.registry });
  assert.equal(other.verifier.sameReceipt, true);
  assert.equal(other.verdict, "CONFIRMED", other.reasons.join(" "));
  /* A verifier that holds another receipt under the reference is still a contradiction. */
  const differ = await verifyReceipt({ receipt: fixture.receipt, verifier: VERIFIER, rpc: [RPC], fetchImpl: async (url, init) => (String(url).startsWith(VERIFIER) ? new Response(JSON.stringify({ data: { ...answer(fixture.receipt).data, summary: { ...publicEngineView(fixture.receipt), operationId: `0x${"12".repeat(32)}` } } })) : arcNode()(url, init)), registry: fixture.registry });
  assert.equal(differ.verdict, "CONTRADICTED");
});

test("a reconciliation a person resolved, and an anchor's own receipt, are never CONFIRMED — and say why", async () => {
  const view = { ...publicEngineView(fixture.receipt), reconciled: false, resolvedByPerson: true };
  const resolved = await checkEngineReceipt(view, { rpc: [RPC], fetchImpl: arcNode(), registry: fixture.registry });
  assert.equal(resolved.checks.find((c) => c.id === "reconciliation").status, "NOT_RECORDED");
  const anchorReceipt = { ...publicEngineView(fixture.receipt), action: "anchor.write", anchor: null };
  const own = await checkEngineReceipt(anchorReceipt, { rpc: [RPC], fetchImpl: arcNode(), registry: fixture.registry });
  assert.match(own.checks.find((c) => c.id === "anchor").detail, /anchored only with its hour's other receipts/);
});
