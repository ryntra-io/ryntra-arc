import assert from "node:assert/strict";
import test from "node:test";
import { KYBER_FEE_TOPIC, KYBER_ROUTER_ON_ARC, proveKyberSelfFee, readKyberFeeCall } from "./kyber-fee.ts";

const WALLET = "0x2222222222222222222222222222222222222222";
const OTHER = "0x1111111111111111111111111111111111111111";
const EXECUTOR = "0x8f10b468b06c6fd214b65f87778827f7d113f996";
const USDC = "0x3600000000000000000000000000000000000000";
const EURC = "0xbef5f6d51cb62b58e6a8f77868681825c6fe21c1";
const u = (value) => BigInt(value).toString(16).padStart(64, "0");
const a = (value) => value.slice(2).padStart(64, "0");
const array = (words) => u(words.length) + words.join("");

/** Synthetic ABI vector; not a transaction to send and contains no real wallet. */
function calldata(side, receiver = WALLET) {
  const input = side === "IN" ? USDC : EURC;
  const output = side === "IN" ? EURC : USDC;
  const desc = [
    a(input), a(output), u(352), u(416), u(480), u(544), a(WALLET),
    u(100_000_000), u(80_000_000), u(side === "IN" ? 640 : 704), u(608),
    array([a(EXECUTOR)]), array([u(side === "IN" ? 99_900_000 : 100_000_000)]),
    array([a(receiver)]), array([u(10)]), u(0),
  ].join("");
  return "0xe21fd0e9" + u(32) + [a(EXECUTOR), u(0), u(160), u(192), u(832), u(0), desc, u(0)].join("");
}

function evidence(side) {
  const fee = side === "IN" ? 100_000n : 110_000n;
  const total = side === "IN" ? 100_000_000n : 110_000_000n;
  const input = side === "IN" ? USDC : EURC;
  const output = side === "IN" ? EURC : USDC;
  const token = side === "IN" ? input : output;
  return {
    router: KYBER_ROUTER_ON_ARC, calldata: calldata(side), wallet: WALLET,
    tokenIn: input, tokenOut: output, bps: 10, side, recordedFee: fee,
    debited: side === "IN" ? 100_000_000n - fee : 100_000_000n,
    credited: side === "IN" ? 88_000_000n : total,
    logs: [{ address: KYBER_ROUTER_ON_ARC, topics: [KYBER_FEE_TOPIC], data: "0x" + [a(token), u(total), u(fee), u(192), u(256), u(1), array([a(WALLET)]), array([u(10)])].join("") }],
    transfers: [
      { token, from: side === "IN" ? WALLET : KYBER_ROUTER_ON_ARC, to: WALLET, amount: fee },
      { token: output, from: KYBER_ROUTER_ON_ARC, to: WALLET, amount: side === "IN" ? 88_000_000n : total - fee },
    ],
  };
}

for (const side of ["IN", "OUT"]) test("self-fee " + side + " is independently proved from the pinned call, event and Transfer", () => {
  const input = evidence(side);
  const call = readKyberFeeCall(input.calldata);
  assert.equal(call.side, side);
  assert.equal(call.bps, 10);
  assert.equal(call.recipientFee, WALLET);
  const proof = proveKyberSelfFee(input);
  assert.equal(proof.proven, true);
  assert.equal(proof.amount, input.recordedFee);
  assert.equal(proof.minimumOut, 80_000_000n);
  assert.equal(proof.grossInput, 100_000_000n);
});

test("missing calldata or Fee evidence cannot be replaced by a coincidental transfer", () => {
  const good = evidence("OUT");
  for (const changed of [
    { ...good, calldata: null }, { ...good, calldata: "0xe21fd0e9" }, { ...good, logs: null }, { ...good, logs: [] },
    { ...good, logs: [{ ...good.logs[0], address: OTHER }] },
    { ...good, calldata: calldata("OUT", OTHER) }, { ...good, recordedFee: good.recordedFee + 1n },
    { ...good, bps: 20 }, { ...good, side: "IN" },
  ]) assert.equal(proveKyberSelfFee(changed).proven, false);
});

test("multiple, split and mixed evidence does not turn all wallet output into a fee", () => {
  const good = evidence("OUT");
  const fee = good.transfers[0];
  for (const changed of [
    { ...good, logs: [...good.logs, good.logs[0]] },
    { ...good, logs: [{ ...good.logs[0], data: good.logs[0].data + u(1) }] },
    { ...good, transfers: good.transfers.slice(1) },
    { ...good, transfers: [...good.transfers, fee] },
    { ...good, transfers: [{ ...fee, amount: fee.amount / 2n }, { ...fee, amount: fee.amount / 2n }, good.transfers[1]] },
    { ...good, transfers: [{ ...fee, from: OTHER }, good.transfers[1]] },
    { ...good, transfers: [{ ...fee, token: EURC }, good.transfers[1]] },
    { ...good, credited: good.credited + fee.amount },
  ]) assert.equal(proveKyberSelfFee(changed).proven, false);
});
