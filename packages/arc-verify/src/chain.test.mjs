/**
 * Reading a transaction from Arc: endpoint fallback, the three outcomes, the
 * comparison of two sources, and the JSON-RPC transport's failures.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { ERC20_TRANSFER_TOPIC, RpcError, decodeTransfers, jsonRpc, readArcTransaction, readingsConflict } from "./chain.ts";
import { ARC_MAINNET_NETWORK, ARC_TESTNET_NETWORK, readEndpoints } from "./networks.ts";
import { EURC, NATIVE_MIRROR, PAYOUT_TX, TREASURY, USDC, chainWorld, fakeFetch, fakeRpc } from "./test-fixtures.mjs";

const A = "https://a.example";
const B = "https://b.example";
const C = "https://c.example";

test("the published endpoints are read in order: the served ones first, then the rest", () => {
  assert.deepEqual(readEndpoints(ARC_TESTNET_NETWORK), [
    "https://rpc.testnet.arc.io",
    "https://rpc.blockdaemon.testnet.arc.io",
    "https://rpc.drpc.testnet.arc.io",
    "https://rpc.quicknode.testnet.arc.io",
  ]);
  assert.deepEqual(readEndpoints(ARC_MAINNET_NETWORK).slice(0, 2), ["https://rpc.drpc.mainnet.arc.io", "https://rpc.blockdaemon.mainnet.arc.io"]);
  assert.equal(new Set(readEndpoints(ARC_MAINNET_NETWORK)).size, 4);
});

test("Transfer events are decoded from any contract; other events are ignored", () => {
  const world = chainWorld("PAYOUT");
  const logs = [
    ...world.eth_getTransactionReceipt.logs,
    { address: USDC, topics: ["0x8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b925", "0x00", "0x00"], data: "0x00", logIndex: "0x20" },
  ];
  const transfers = decodeTransfers(logs);
  assert.equal(transfers.length, 2);
  assert.deepEqual(transfers.map((transfer) => transfer.token), [NATIVE_MIRROR, USDC]);
  assert.equal(transfers[1].from, TREASURY);
  assert.equal(transfers[1].amount, 1_000_000n);
  assert.equal(transfers[0].amount, 1_000_000n * 10n ** 12n);
  assert.equal(decodeTransfers([{ address: "not an address", topics: [ERC20_TRANSFER_TOPIC, "0x", "0x"], data: "0x" }]), null);
  assert.equal(decodeTransfers("not logs"), null);
});

test("an endpoint that refuses or has no history is skipped, and the next one is read", async () => {
  const { call } = fakeRpc({ [A]: new RpcError("HTTP 403"), [B]: { ...chainWorld("PAYOUT"), eth_getTransactionReceipt: null }, [C]: chainWorld("PAYOUT") });
  const outcome = await readArcTransaction({ network: ARC_TESTNET_NETWORK, transactionHash: PAYOUT_TX, endpoints: [A, B, C], call });
  assert.equal(outcome.state, "READ");
  assert.equal(outcome.readings.length, 1);
  const [reading] = outcome.readings;
  assert.equal(reading.endpoint, C);
  assert.equal(reading.status, "success");
  assert.equal(reading.blockNumber, 1000);
  assert.equal(reading.headBlock, 1009);
  assert.equal(reading.blockTimestamp, "2026-08-10T12:00:10.000Z");
  assert.equal(reading.gasUsed * reading.effectiveGasPriceWei, 1_233_540_000_000_000n);
  assert.deepEqual(reading.tokenDecimals, { [USDC]: 6 });
  assert.deepEqual(outcome.notes.map((note) => [note.endpoint, note.outcome, note.detail]), [
    [A, "UNREACHABLE", "HTTP 403"],
    [B, "NOT_SEEN", "has no receipt for this transaction"],
  ]);
});

test("two answering endpoints are both read so they can be compared, and no more", async () => {
  const { call, calls } = fakeRpc({ [A]: chainWorld("PAYOUT"), [B]: chainWorld("PAYOUT"), [C]: chainWorld("PAYOUT") });
  const outcome = await readArcTransaction({ network: ARC_TESTNET_NETWORK, transactionHash: PAYOUT_TX, endpoints: [A, B, C], call });
  assert.equal(outcome.readings.length, 2);
  assert.equal(calls.some((entry) => entry.endpoint === C), false);
  assert.equal(readingsConflict(outcome.readings), null);
});

test("two endpoints that disagree are named, never averaged", async () => {
  const forged = chainWorld("PAYOUT");
  forged.eth_getTransactionReceipt = {
    ...forged.eth_getTransactionReceipt,
    logs: forged.eth_getTransactionReceipt.logs.map((log) => (log.address === USDC ? { ...log, data: `0x${(2_000_000).toString(16).padStart(64, "0")}` } : log)),
  };
  const { call } = fakeRpc({ [A]: chainWorld("PAYOUT"), [B]: forged });
  const outcome = await readArcTransaction({ network: ARC_TESTNET_NETWORK, transactionHash: PAYOUT_TX, endpoints: [A, B], call });
  assert.equal(readingsConflict(outcome.readings), `${A} and ${B} disagree on transfers`);
});

test("every answering endpoint without the receipt is NOT_FOUND; no answer at all is UNREADABLE", async () => {
  const none = { ...chainWorld("PAYOUT"), eth_getTransactionReceipt: null };
  let outcome = await readArcTransaction({ network: ARC_TESTNET_NETWORK, transactionHash: PAYOUT_TX, endpoints: [A, B], call: fakeRpc({ [A]: new RpcError("HTTP 403"), [B]: none }).call });
  assert.equal(outcome.state, "NOT_FOUND");
  outcome = await readArcTransaction({ network: ARC_TESTNET_NETWORK, transactionHash: PAYOUT_TX, endpoints: [A, B], call: fakeRpc({ [A]: new RpcError("HTTP 403"), [B]: new RpcError("timed out") }).call });
  assert.equal(outcome.state, "UNREADABLE");
  assert.deepEqual(outcome.notes.map((note) => note.detail), ["HTTP 403", "timed out"]);
});

test("an endpoint serving another chain is not read as Arc", async () => {
  const { call } = fakeRpc({ [A]: { ...chainWorld("PAYOUT"), eth_chainId: "0x1" } });
  const outcome = await readArcTransaction({ network: ARC_TESTNET_NETWORK, transactionHash: PAYOUT_TX, endpoints: [A], call });
  assert.equal(outcome.state, "UNREADABLE");
  assert.equal(outcome.notes[0].outcome, "OTHER_CHAIN");
  assert.match(outcome.notes[0].detail, /serves chain id 1, not Arc Testnet \(5042002\)/);
});

test("an endpoint returning a receipt for another transaction or a malformed block is inconsistent", async () => {
  const other = chainWorld("PAYOUT");
  other.eth_getTransactionReceipt = { ...other.eth_getTransactionReceipt, transactionHash: `0x${"ff".repeat(32)}` };
  const badBlock = chainWorld("PAYOUT");
  badBlock.eth_getBlockByNumber = { ...badBlock.eth_getBlockByNumber, hash: `0x${"ee".repeat(32)}` };
  const { call } = fakeRpc({ [A]: other, [B]: badBlock });
  const outcome = await readArcTransaction({ network: ARC_TESTNET_NETWORK, transactionHash: PAYOUT_TX, endpoints: [A, B], call });
  assert.equal(outcome.state, "UNREADABLE");
  assert.deepEqual(outcome.notes.map((note) => note.outcome), ["INCONSISTENT", "INCONSISTENT"]);
});

test("decimals are read for each Circle token that moved", async () => {
  const { call, calls } = fakeRpc({ [A]: chainWorld("SWAP") });
  const outcome = await readArcTransaction({ network: ARC_TESTNET_NETWORK, transactionHash: chainWorld("SWAP").eth_getTransactionReceipt.transactionHash, endpoints: [A], call });
  assert.deepEqual(outcome.readings[0].tokenDecimals, { [USDC]: 6, [EURC]: 6 });
  assert.equal(calls.filter((entry) => entry.method === "eth_call").length, 2);
  assert.equal(calls.some((entry) => /send|sign/i.test(entry.method)), false, "read-only");
});

test("the JSON-RPC transport names HTTP refusals, errors and empty answers", async () => {
  const cases = [
    [async () => new Response("no", { status: 403 }), "HTTP 403"],
    [async () => new Response("<html>", { status: 200 }), "answered with something that is not JSON"],
    [async () => Response.json({ jsonrpc: "2.0", id: 1, error: { code: -32000, message: "x" } }), "JSON-RPC error -32000"],
    [async () => Response.json({ jsonrpc: "2.0", id: 1 }), "answered without a result"],
    [async () => { throw new TypeError("fetch failed"); }, "could not be reached"],
  ];
  for (const [impl, message] of cases) {
    await assert.rejects(jsonRpc(impl)("https://x.example", "eth_chainId", []), (error) => error instanceof RpcError && error.message === message);
  }
  const { impl } = fakeFetch({ worlds: { [A]: chainWorld("PAYOUT") } });
  assert.equal(await jsonRpc(impl)(A, "eth_chainId", []), "0x4cef52");
});
