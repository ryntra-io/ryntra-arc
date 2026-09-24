/**
 * Receipts and chain readings for the network-free tests.
 *
 * The receipts are complete documents of the shape the product issues — each
 * one is sealed here with the same functions the product seals with — but
 * every wallet, hash and identifier in them is synthetic. The readings are
 * what an Arc endpoint returns for the transaction each receipt records,
 * including the native-currency mirror events Arc emits beside every USDC
 * Transfer, so a check that counted those would fail here first.
 */

import { hashCanonical, hashReceiptCore } from "./canonical.ts";
import { checkSeal, publicSummary, receiptKind } from "./receipt.ts";

export const TREASURY = "0x1111111111111111111111111111111111111111";
export const BENEFICIARY = "0x2222222222222222222222222222222222222222";
export const ADAPTER = "0x3333333333333333333333333333333333333333";
export const USDC = "0x3600000000000000000000000000000000000000";
export const EURC = "0x89b50855aa3be2f677cd6303cec089b5f319d72a";
/** The address Arc's native-currency mirror events come from. */
export const NATIVE_MIRROR = "0xfffffffffffffffffffffffffffffffffffffffe";

const h = (byte) => `0x${byte.repeat(32)}`;
export const PAYOUT_TX = h("a1");
export const TRANSFER_TX = h("a2");
export const SWAP_TX = h("a3");
export const BLOCK_HASH = h("b1");

const TESTNET = "eip155:5042002";
const LIMITATIONS = ["RYNTRA_DID_NOT_SIGN_OR_BROADCAST", "NOT_LEGAL_OR_COMPLIANCE_PROOF", "ARC_PUBLIC_TESTNET_ONLY"];

/** Seal a receipt core with both hashes, exactly as the product does. */
export function seal(core) {
  const receiptHash = hashReceiptCore(core);
  return { ...core, receiptHash, integrity: { algorithm: "SHA-256", hash: hashCanonical({ ...core, receiptHash }) } };
}

function common({ schemaVersion, id, tx, expected, actual, bindingKind, calldataBound, method, times, sourceRef, verificationStatus }) {
  return {
    schemaVersion,
    id,
    tenantId: "tenant_example",
    evidenceStatus: "COMPLETE",
    policyDecision: "ALLOWED_BY_POLICY",
    authorizationStatus: "APPROVED",
    executionStatus: "CONFIRMED",
    policyVersion: 1,
    policyDigest: h("c5"),
    preflightHash: h("c2"),
    expectedEffects: expected,
    actualEffects: actual,
    reconciliationStatus: "MATCHED",
    intent: { id: `int_${id.split("_")[1]}`, revision: 1, hash: h("c3") },
    evidence: { root: h("c4"), refs: ["evd_0000000000000001"] },
    policy: { id: "pol_example", version: 1, hash: h("c5"), outcome: "ALLOWED_BY_POLICY" },
    authorization: {
      id: "aut_0000000000000001",
      method,
      subjectRef: "principal:approver-example",
      createdAt: times.authorized,
      expiresAt: times.expires,
      executionFingerprintHash: h("c6"),
    },
    execution: {
      id: "exe_0000000000000001",
      fingerprintHash: h("c6"),
      bindingKind,
      productionCalldataBound: calldataBound,
      transactionHash: tx,
      status: "CONFIRMED",
      explorerUrl: `https://testnet.arcscan.app/tx/${tx}`,
    },
    reconciliation: {
      status: "MATCHED",
      expected,
      actual,
      evidence: {
        provider: "arc-rpc",
        sourceRef,
        verificationStatus,
        observedAt: times.observed,
        responseDigest: h("c7"),
      },
    },
    settlement: { status: "CONFIRMED", recoveryState: "NOT_REQUIRED" },
    createdAt: times.created,
    finalizedAt: times.finalized,
  };
}

/** A 1 USDC payout from the treasury to a beneficiary, fee rounded up to 6 decimals. */
export function payoutCore() {
  const expected = { amountIn: "1.000000", amountOut: "1.000000", minimumAmountOut: "1.000000", feeAmount: "0.010000", totalDebit: "1.010000" };
  const actual = { amountIn: "1.000000", amountOut: "1.000000", feeAmount: "0.001234" };
  return {
    ...common({
      schemaVersion: "1.2.0",
      id: "rcp_00000000000000000000000000000001",
      tx: PAYOUT_TX,
      expected,
      actual,
      bindingKind: "EVM_TRANSACTION",
      calldataBound: true,
      method: "PARTNER_AUTHENTICATED",
      sourceRef: `${TESTNET}:tx:${PAYOUT_TX}`,
      verificationStatus: "ONCHAIN_VERIFIED",
      times: {
        authorized: "2026-08-10T12:00:00.000Z",
        created: "2026-08-10T12:00:09.000Z",
        expires: "2026-08-10T12:15:00.000Z",
        observed: "2026-08-10T12:00:10.000Z",
        finalized: "2026-08-10T12:00:12.000Z",
      },
    }),
    limitations: [...LIMITATIONS, "EXTERNAL_SOURCE_TRUTH_NOT_GUARANTEED"],
    payout: {
      payoutId: "pay_0000000000000001",
      purposeCode: "INVOICE",
      amount: "1.000000",
      amountBaseUnits: "1000000",
      beneficiaryRef: "ben_0000000000000001",
      beneficiaryVersion: 1,
      beneficiaryWalletAddress: BENEFICIARY,
      treasuryWalletAddress: TREASURY,
      payoutInstructionHash: h("d1"),
      beneficiaryVersionHash: h("d2"),
      policyVersionHash: h("c5"),
      approvalSetHash: h("d3"),
      externalReferenceHash: null,
      reservationId: "rsv_0000000000000001",
      requiredApprovalCount: 1,
      receivedApprovalCount: 1,
      requesterRef: "principal:requester-example",
      approverRefs: ["principal:approver-example"],
      maxTotalDebitBaseUnits: "1010000",
      actualTotalDebitBaseUnits: "1001234",
      chain: { chainRef: TESTNET, chainId: 5042002, assetRef: `${TESTNET}/erc20:${USDC}`, contractAddress: USDC, decimals: 6 },
      provenance: {
        rpcSourceRef: "https://rpc.testnet.arc.io",
        blockNumber: 1000,
        blockHash: BLOCK_HASH,
        transactionIndex: 4,
        logIndex: 11,
        confirmations: 1,
        observedAt: "2026-08-10T12:00:10.000Z",
      },
    },
  };
}

/** A 1 USDC transfer, fee recorded exactly in the 18-decimal native unit. */
export function transferCore() {
  const expected = { amountIn: "1.000000", amountOut: "1.000000", minimumAmountOut: "1.000000", feeAmount: "0.010000", totalDebit: "1.010000" };
  const actual = { amountIn: "1.000000", amountOut: "1.000000", feeAmount: "0.00153083895" };
  return {
    ...common({
      schemaVersion: "1.1.0",
      id: "rcpt_00000000000000000000000000000002",
      tx: TRANSFER_TX,
      expected,
      actual,
      bindingKind: "EVM_TRANSACTION",
      calldataBound: true,
      method: "EIP712",
      sourceRef: `${TESTNET}:tx:${TRANSFER_TX}`,
      verificationStatus: "ONCHAIN_VERIFIED",
      times: {
        authorized: "2026-08-10T12:00:00.000Z",
        created: "2026-08-10T12:00:00.000Z",
        expires: "2026-08-10T12:15:00.000Z",
        observed: "2026-08-10T12:00:10.000Z",
        finalized: "2026-08-10T12:00:12.000Z",
      },
    }),
    limitations: LIMITATIONS,
  };
}

/** 3 USDC exchanged for 2.651611 EURC through an adapter contract. */
export function swapCore() {
  const expected = { amountIn: "3.000000", amountOut: "2.651611", minimumAmountOut: "2.600000", feeAmount: "0.020000", totalDebit: "3.020000" };
  const actual = { amountIn: "3.000000", amountOut: "2.651611", feeAmount: "0.0162269856" };
  return {
    ...common({
      schemaVersion: "1.3.0",
      id: "rcpt_00000000000000000000000000000003",
      tx: SWAP_TX,
      expected,
      actual,
      bindingKind: "APP_KIT_REQUEST",
      calldataBound: false,
      method: "EIP712",
      sourceRef: `${TESTNET}:tx:${SWAP_TX}`,
      verificationStatus: "ONCHAIN_VERIFIED",
      times: {
        authorized: "2026-08-10T12:00:00.000Z",
        created: "2026-08-10T12:00:00.000Z",
        expires: "2026-08-10T12:15:00.000Z",
        observed: "2026-08-10T12:00:10.000Z",
        finalized: "2026-08-10T12:00:12.000Z",
      },
    }),
    limitations: [...LIMITATIONS, "SWAP_ROUTE_FEE_PROVIDER_QUOTED_NOT_CHAIN_ATTRIBUTED"],
    swap: {
      quoteRef: "quote_example",
      provider: "CIRCLE_APP_KIT",
      routeRef: "route_example",
      routeDisclosure: "PROVIDER_ROUTED",
      slippageBps: "100",
      sellAssetRef: `${TESTNET}/erc20:${USDC}`,
      buyAssetRef: `${TESTNET}/erc20:${EURC}`,
      quotedFees: {
        components: [{ type: "network", token: "USDC", amount: "0.020000", side: "NETWORK", takenFrom: "ON_TOP_OF_INPUT" }],
        networkAmount: "0.020000",
        routeAmount: null,
        totalAmount: "0.020000",
        coverage: "NETWORK_ONLY",
      },
      settledFees: {
        networkAmount: "0.0162269856",
        networkSource: "CHAIN_RECEIPT",
        routeAmount: null,
        routeSource: "UNAVAILABLE",
        routeObservability: "NOT_ATTRIBUTABLE_ON_CHAIN",
        coverage: "NETWORK_ONLY",
      },
      debit: { authorizedCeiling: "3.020000", settledTotal: "3.0162269856", settledSource: "CHAIN_RECEIPT" },
      authorizedMinimumAmountOut: "2.600000",
      deviations: [],
    },
  };
}

export const payoutReceipt = () => seal(payoutCore());
export const transferReceipt = () => seal(transferCore());
export const swapReceipt = () => seal(swapCore());

/** The body a Ryntra receipt verifier returns for a stored receipt, assembled as it assembles it. */
export function verifierBody(receipt, receiptRef = receipt.id) {
  const outcome = checkSeal(receipt);
  const envelope = {
    receiptRef,
    checkedAt: "2026-08-10T12:30:00.000Z",
    supersessionModelled: false,
    supportedKinds: ["TRANSFER", "SWAP", "PAYOUT", "BRIDGE"],
  };
  if (outcome.state !== "CHECKED") throw new Error("the fixture is not sealed");
  if (!outcome.intact) return { data: { ...envelope, verdict: "TAMPERED", kind: receiptKind(receipt), summary: null, integrity: outcome.report } };
  return { data: { ...envelope, verdict: "VERIFIED", summary: publicSummary(receipt), integrity: outcome.report } };
}

export const NOT_FOUND_BODY = (receiptRef) => ({ data: { receiptRef, verdict: "NOT_FOUND", summary: null, integrity: null } });

/* ------------------------------------------------------------------ *
 * What an Arc endpoint answers
 * ------------------------------------------------------------------ */

const word = (value) => `0x${value.toString(16).padStart(64, "0")}`;
const topicOf = (address) => `0x${address.slice(2).padStart(64, "0")}`;
const hex = (value) => `0x${BigInt(value).toString(16)}`;
const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

/** A Transfer log of `token`, and — for USDC — the native mirror Arc emits beside it. */
function transferLogs(token, from, to, amount, logIndex) {
  const logs = [];
  if (token === USDC) {
    logs.push({ address: NATIVE_MIRROR, topics: [TRANSFER_TOPIC, topicOf(from), topicOf(to)], data: word(BigInt(amount) * 10n ** 12n), logIndex: hex(logIndex - 1) });
  }
  logs.push({ address: token, topics: [TRANSFER_TOPIC, topicOf(from), topicOf(to)], data: word(BigInt(amount)), logIndex: hex(logIndex) });
  return logs;
}

/** The raw JSON-RPC results for one transaction, keyed by method. */
export function chainWorld(kind) {
  const plan = {
    PAYOUT: { tx: PAYOUT_TX, to: USDC, gasUsed: 48_950, gasPrice: 25_200_000_000n, logs: transferLogs(USDC, TREASURY, BENEFICIARY, 1_000_000, 11) },
    TRANSFER: { tx: TRANSFER_TX, to: USDC, gasUsed: 73_950, gasPrice: 20_701_000_000n, logs: transferLogs(USDC, TREASURY, BENEFICIARY, 1_000_000, 11) },
    SWAP: {
      tx: SWAP_TX,
      to: ADAPTER,
      gasUsed: 643_928,
      gasPrice: 25_200_000_000n,
      logs: [
        ...transferLogs(USDC, TREASURY, ADAPTER, 3_000_000, 21),
        ...transferLogs(USDC, ADAPTER, "0x4444444444444444444444444444444444444444", 2_999_400, 23),
        ...transferLogs(EURC, "0x4444444444444444444444444444444444444444", ADAPTER, 2_651_611, 24),
        ...transferLogs(EURC, ADAPTER, TREASURY, 2_651_611, 25),
      ],
    },
  }[kind];
  return {
    eth_chainId: "0x4cef52",
    eth_blockNumber: hex(1_009),
    eth_getTransactionReceipt: {
      transactionHash: plan.tx,
      status: "0x1",
      blockNumber: hex(1_000),
      blockHash: BLOCK_HASH,
      transactionIndex: hex(4),
      gasUsed: hex(plan.gasUsed),
      effectiveGasPrice: hex(plan.gasPrice),
      logs: plan.logs,
    },
    eth_getTransactionByHash: { hash: plan.tx, from: TREASURY, to: plan.to, value: "0x0", input: "0x", gasPrice: hex(plan.gasPrice) },
    eth_getBlockByNumber: { number: hex(1_000), hash: BLOCK_HASH, timestamp: hex(Date.parse("2026-08-10T12:00:10.000Z") / 1000) },
    eth_call: word(6n),
  };
}

/** An `RpcCall` that answers from per-endpoint worlds; an Error value is thrown, a function is called. */
export function fakeRpc(worlds) {
  const calls = [];
  const call = async (endpoint, method, params) => {
    calls.push({ endpoint, method, params });
    const world = worlds[endpoint];
    if (world instanceof Error) throw world;
    if (!world) throw new Error(`no world for ${endpoint}`);
    const answer = world[method];
    if (answer instanceof Error) throw answer;
    return typeof answer === "function" ? answer(params) : answer;
  };
  return { call, calls };
}

/** A `fetch` that serves JSON-RPC from worlds by URL and the verifier from `verifier`. */
export function fakeFetch({ worlds = {}, verifier = null } = {}) {
  const requests = [];
  const impl = async (input, init = {}) => {
    const url = String(input);
    requests.push(url);
    if (verifier && url.startsWith(verifier.url)) {
      const ref = new URL(url).searchParams.get("ref");
      const { status = 200, body } = verifier.answer(ref);
      return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
    }
    const world = worlds[url];
    if (!world) return new Response("forbidden", { status: 403 });
    const { id, method } = JSON.parse(init.body);
    const answer = world[method];
    return new Response(JSON.stringify({ jsonrpc: "2.0", id, result: answer === undefined ? null : answer }), { status: 200, headers: { "content-type": "application/json" } });
  };
  return { impl, requests };
}
