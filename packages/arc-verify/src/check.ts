/**
 * What a receipt claims, and whether Arc agrees.
 *
 * Pure functions over two things the caller already has: the facts a receipt
 * (or its public summary) states, and one reading of the transaction from the
 * chain. Nothing here fetches.
 *
 * Every check ends in one of three states, and only one of them is a failure:
 *
 * - `MATCH` — the chain shows what the receipt states;
 * - `MISMATCH` — the chain shows something else, and the receipt is wrong;
 * - `NOT_RECORDED` — the receipt, or the public summary of it, does not state
 *   this fact, so there is nothing to hold the chain against. A public summary
 *   never names wallets; the receipt file itself does, for a payout.
 *
 * ## Units
 *
 * USDC and EURC move as 6-decimal ERC-20 amounts. Arc's network fee is paid in
 * USDC as the native currency, which has 18 decimals, so a fee is
 * `gasUsed × effectiveGasPrice` in that unit. A receipt states the fee either
 * exactly or rounded up to 6 decimals — the unit a payout's debit is counted
 * in — and both are accepted as a match. Rounding down never is.
 *
 * Arc reports each USDC movement twice: as a Transfer event of the USDC
 * token contract (6 decimals) and as a native-currency event from a system
 * address (18 decimals). Only the token contract's own events are counted.
 */

import { assetAddressOn, circleTokenAt, circleTokens } from "./networks.ts";
import type { ArcNetwork, CircleToken } from "./networks.ts";
import type { ArcTransactionReading, TokenTransfer } from "./chain.ts";
import { lowerHash, object, receiptKind, text } from "./receipt.ts";
import type { Json, ReceiptKind } from "./receipt.ts";

export type CheckStatus = "MATCH" | "MISMATCH" | "NOT_RECORDED";

export type Check = Readonly<{ id: string; status: CheckStatus; detail: string }>;

/** The kinds this package reads back from Arc. */
export const CHECKED_KINDS: readonly ReceiptKind[] = ["TRANSFER", "PAYOUT", "SWAP", "RECEIVED"];

export type PayoutFacts = Readonly<{
  amount: string | null;
  maxTotalDebitBaseUnits: string | null;
  actualTotalDebitBaseUnits: string | null;
  blockNumber: number | null;
  blockHash: string | null;
  transactionIndex: number | null;
  logIndex: number | null;
  contractAddress: string | null;
  treasuryWalletAddress: string | null;
  beneficiaryWalletAddress: string | null;
}>;

/** A token as a swap through an aggregator's router names it (1.9.0): by address, with its decimals. */
export type RouteToken = Readonly<{ address: string; symbol: string; decimals: number }>;

/** What a swap through an aggregator's router states (1.9.0): the router, the two assets and Ryntra's fee. */
export type SwapRouteFacts = Readonly<{
  router: string | null;
  tokenIn: RouteToken;
  tokenOut: RouteToken;
  /** Ryntra's fee as collected, in its token; null when the receipt states no fee. */
  fee: Readonly<{ amount: string; token: RouteToken }> | null;
}>;

export type SwapFacts = Readonly<{
  sellAssetRef: string | null;
  buyAssetRef: string | null;
  networkFee: string | null;
  /** Set for a swap through an aggregator's router (1.9.0); null for Circle's exchange (1.3.0, 1.5.0). */
  route?: SwapRouteFacts | null;
}>;

/** A payment a team received through its request: which asset, and — in the file only — both wallets. */
export type ReceivedFacts = Readonly<{
  asset: string | null;
  payee: string | null;
  payer: string | null;
}>;

/** What a receipt states that the chain can confirm or refute. */
export type ReceiptFacts = Readonly<{
  source: "RECEIPT" | "PUBLIC_SUMMARY";
  kind: ReceiptKind;
  schemaVersion: string | null;
  chainRef: string | null;
  transactionHash: string | null;
  amountIn: string | null;
  amountOut: string | null;
  feeAmount: string | null;
  /** The least the buyer accepted, when the receipt records an exchange. */
  minimumAmountOut: string | null;
  finalizedAt: string | null;
  payout: PayoutFacts | null;
  swap: SwapFacts | null;
  received: ReceivedFacts | null;
}>;

function integer(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) ? value : null;
}

function evmAddress(value: unknown): string | null {
  const raw = text(value);
  return raw && /^0x[0-9a-fA-F]{40}$/.test(raw) ? raw.toLowerCase() : null;
}

/** Wei of Arc's native USDC (18 places) as a plain decimal. */
function weiDecimal(wei: string | null): string | null {
  if (wei === null || !/^\d+$/.test(wei)) return null;
  return fromBaseUnits(BigInt(wei), 18, false);
}

function routeToken(value: unknown): RouteToken | null {
  const token = object(value);
  const address = evmAddress(token?.address);
  const decimals = integer(token?.decimals);
  return address && decimals !== null ? { address, symbol: text(token?.symbol) ?? "?", decimals } : null;
}

/** The facts a 1.9.0 swap states about its router, its assets and Ryntra's fee. */
function swapRouteFacts(swap: Json): SwapRouteFacts | null {
  const tokenIn = routeToken(swap.tokenIn);
  const tokenOut = routeToken(swap.tokenOut);
  if (!tokenIn || !tokenOut) return null;
  const fee = object(swap.ryntraFee);
  const actual = object(fee?.actual);
  const feeToken = text(fee?.side) === "OUT" ? tokenOut : tokenIn;
  const amount = text(actual?.amount);
  return {
    router: evmAddress(object(swap.provider)?.router),
    tokenIn,
    tokenOut,
    fee: fee && amount ? { amount, token: feeToken } : null,
  };
}

function chainRefFromRecord(record: Json): string | null {
  const declared = text(object(object(record.payout)?.chain)?.chainRef) ?? text(object(record.received)?.chainRef);
  if (declared) return declared;
  const sourceRef = text(object(object(record.reconciliation)?.evidence)?.sourceRef);
  const marker = sourceRef ? sourceRef.indexOf(":tx:") : -1;
  return sourceRef && marker > 0 ? sourceRef.slice(0, marker) : null;
}

/** The facts a full receipt states. */
export function factsFromReceipt(record: Json): ReceiptFacts {
  const actual = object(record.actualEffects);
  const payout = object(record.payout);
  const swap = object(record.swap);
  const provenance = object(payout?.provenance);
  const received = object(record.received);
  return {
    source: "RECEIPT",
    kind: receiptKind(record),
    schemaVersion: text(record.schemaVersion),
    chainRef: chainRefFromRecord(record),
    transactionHash: lowerHash(object(record.execution)?.transactionHash) ?? lowerHash(received?.transactionHash),
    amountIn: text(actual?.amountIn) ?? text(received?.amount),
    amountOut: text(actual?.amountOut),
    /* A 1.9.0 swap's effects name the provider's own fee, never the network's: it states the network fee apart. */
    feeAmount: text(record.schemaVersion) === "1.9.0" ? null : text(actual?.feeAmount),
    minimumAmountOut:
      text(swap?.authorizedMinimumAmountOut) ?? text(object(swap?.quote)?.minimumOut) ?? text(object(record.expectedEffects)?.minimumAmountOut),
    finalizedAt: text(record.finalizedAt),
    payout: payout
      ? {
          amount: text(payout.amount),
          maxTotalDebitBaseUnits: text(payout.maxTotalDebitBaseUnits),
          actualTotalDebitBaseUnits: text(payout.actualTotalDebitBaseUnits),
          blockNumber: integer(provenance?.blockNumber),
          blockHash: lowerHash(provenance?.blockHash),
          transactionIndex: integer(provenance?.transactionIndex),
          logIndex: integer(provenance?.logIndex),
          contractAddress: evmAddress(object(payout.chain)?.contractAddress),
          treasuryWalletAddress: evmAddress(payout.treasuryWalletAddress),
          beneficiaryWalletAddress: evmAddress(payout.beneficiaryWalletAddress),
        }
      : null,
    swap: swap
      ? text(record.schemaVersion) === "1.9.0"
        ? {
            sellAssetRef: null,
            buyAssetRef: null,
            /* The receipt states the network fee in wei; the checks read it as a decimal. */
            networkFee: weiDecimal(text(object(swap.networkFee)?.amount)),
            route: swapRouteFacts(swap),
          }
        : {
            sellAssetRef: text(swap.sellAssetRef),
            buyAssetRef: text(swap.buyAssetRef),
            networkFee: text(object(swap.settledFees)?.networkAmount),
          }
      : null,
    received: received
      ? { asset: text(received.asset), payee: evmAddress(received.payee), payer: evmAddress(received.payer) }
      : null,
  };
}

const KINDS: readonly ReceiptKind[] = ["TRANSFER", "SWAP", "PAYOUT", "BRIDGE", "RECEIVED", "UNKNOWN"];

/** The facts a verifier's public summary states — never a wallet. */
export function factsFromSummary(summary: Json): ReceiptFacts {
  const detail = object(summary.detail);
  const kindText = text(summary.kind);
  const kind = KINDS.find((entry) => entry === kindText) ?? "UNKNOWN";
  return {
    source: "PUBLIC_SUMMARY",
    kind,
    schemaVersion: text(summary.schemaVersion),
    chainRef: text(summary.chainRef),
    transactionHash: lowerHash(summary.transactionHash),
    amountIn: text(summary.amountIn),
    amountOut: text(summary.amountOut),
    feeAmount: text(summary.schemaVersion) === "1.9.0" ? null : text(summary.feeAmount),
    minimumAmountOut: kind === "SWAP" ? text(detail?.authorizedMinimumAmountOut) : null,
    finalizedAt: text(summary.finalizedAt),
    payout: kind === "PAYOUT" && detail
      ? {
          amount: text(detail.amount),
          maxTotalDebitBaseUnits: text(detail.maxTotalDebit),
          actualTotalDebitBaseUnits: text(detail.actualTotalDebit),
          blockNumber: integer(detail.blockNumber),
          blockHash: null,
          transactionIndex: null,
          logIndex: null,
          contractAddress: null,
          treasuryWalletAddress: null,
          beneficiaryWalletAddress: null,
        }
      : null,
    swap: kind === "SWAP" && detail
      ? {
          sellAssetRef: null,
          buyAssetRef: null,
          networkFee: text(detail.settledNetworkFee),
          route: summaryRouteFacts(detail),
        }
      : null,
    /* The public summary never names a wallet: payee and payer are checked only from the file. */
    received: kind === "RECEIVED" ? { asset: text(detail?.asset), payee: null, payer: null } : null,
  };
}

/** A 1.9.0 swap's router, assets and fee, as its public summary states them; null for any other swap. */
function summaryRouteFacts(detail: Json): SwapRouteFacts | null {
  const token = (prefix: "tokenIn" | "tokenOut"): RouteToken | null => {
    const address = evmAddress(detail[`${prefix}Address`]);
    const decimals = integer(detail[`${prefix}Decimals`]);
    return address && decimals !== null ? { address, symbol: text(detail[prefix]) ?? "?", decimals } : null;
  };
  const tokenIn = token("tokenIn");
  const tokenOut = token("tokenOut");
  if (!tokenIn || !tokenOut) return null;
  /* «0.1 USDC»: the amount, then its asset. */
  const actual = text(detail.ryntraFeeActual)?.split(" ")[0] ?? null;
  return {
    router: evmAddress(detail.router),
    tokenIn,
    tokenOut,
    fee: actual ? { amount: actual, token: text(detail.ryntraFeeSide) === "OUT" ? tokenOut : tokenIn } : null,
  };
}

/* ------------------------------------------------------------------ *
 * Decimal arithmetic on strings and bigints — never on floats
 * ------------------------------------------------------------------ */

const DECIMAL = /^(0|[1-9]\d{0,40})(?:\.(\d{1,40}))?$/;

/** A decimal string in base units, or null when it is not one or needs more decimals. */
export function toBaseUnits(value: string | null, decimals: number): bigint | null {
  const match = value === null ? null : DECIMAL.exec(value);
  if (!match) return null;
  const fraction = match[2] ?? "";
  if (fraction.length > decimals && !/^0*$/.test(fraction.slice(decimals))) return null;
  const kept = fraction.slice(0, decimals).padEnd(decimals, "0");
  return BigInt(match[1]) * 10n ** BigInt(decimals) + BigInt(kept || "0");
}

/** Base units as a decimal string; `fixed` keeps every decimal place. */
export function fromBaseUnits(units: bigint, decimals: number, fixed = true): string {
  const negative = units < 0n;
  const magnitude = negative ? -units : units;
  const scale = 10n ** BigInt(decimals);
  const whole = magnitude / scale;
  let fraction = (magnitude % scale).toString().padStart(decimals, "0");
  if (!fixed) fraction = fraction.replace(/0+$/, "");
  const body = fraction ? `${whole}.${fraction}` : `${whole}`;
  return negative ? `-${body}` : body;
}

const NATIVE_TO_SIX = 10n ** 12n;

/** The 18-decimal native fee rounded up to a 6-decimal amount. */
export function ceilToSixDecimals(nativeUnits: bigint): bigint {
  return (nativeUnits + NATIVE_TO_SIX - 1n) / NATIVE_TO_SIX;
}

/* ------------------------------------------------------------------ *
 * The checks
 * ------------------------------------------------------------------ */

const match = (id: string, detail: string): Check => ({ id, status: "MATCH", detail });
const mismatch = (id: string, detail: string): Check => ({ id, status: "MISMATCH", detail });
const notRecorded = (id: string, detail: string): Check => ({ id, status: "NOT_RECORDED", detail });

function short(value: string): string {
  return value.length > 14 ? `${value.slice(0, 6)}…${value.slice(-4)}` : value;
}

function tokenTransfers(reading: ArcTransactionReading, token: CircleToken): TokenTransfer[] {
  const address = token.address.toLowerCase();
  return reading.transfers.filter((transfer) => transfer.token === address);
}

/** The wallet's net movement of one token in this transaction: in minus out. */
function netFlow(reading: ArcTransactionReading, token: CircleToken, wallet: string): bigint {
  let net = 0n;
  for (const transfer of tokenTransfers(reading, token)) {
    if (transfer.to === wallet) net += transfer.amount;
    if (transfer.from === wallet) net -= transfer.amount;
  }
  return net;
}

function checkDecimals(reading: ArcTransactionReading, tokens: readonly CircleToken[]): Check[] {
  return tokens.map((token) => {
    const reported = reading.tokenDecimals[token.address.toLowerCase()];
    if (reported === token.decimals) return match(`${token.key}-decimals`, `${token.symbol} reports ${reported} decimals, the unit the receipt counts in`);
    return mismatch(`${token.key}-decimals`, `${token.symbol} reports ${reported ?? "no"} decimals; the receipt counts in ${token.decimals}`);
  });
}

function checkFee(facts: ReceiptFacts, reading: ArcTransactionReading): Check {
  const exact = reading.gasUsed * reading.effectiveGasPriceWei;
  const shown = `${fromBaseUnits(exact, 18, false)} USDC (${reading.gasUsed} gas at ${fromBaseUnits(reading.effectiveGasPriceWei, 9, false)} gwei)`;
  const recorded = facts.swap?.networkFee ?? facts.feeAmount;
  if (recorded === null) return notRecorded("fee", `the network fee was ${shown}; the ${facts.source === "RECEIPT" ? "receipt" : "summary"} states none`);
  if (toBaseUnits(recorded, 18) === exact) return match("fee", `the network fee was ${shown}, exactly as recorded`);
  if (toBaseUnits(recorded, 6) === ceilToSixDecimals(exact)) {
    return match("fee", `the network fee was ${shown}; recorded as ${recorded}, rounded up to 6 decimals`);
  }
  return mismatch("fee", `the network fee was ${shown}; the receipt records ${recorded}`);
}

function checkTime(facts: ReceiptFacts, reading: ArcTransactionReading): Check {
  if (facts.finalizedAt === null) return notRecorded("time", `settled at ${reading.blockTimestamp}; no sealing time is recorded`);
  const sealed = Date.parse(facts.finalizedAt);
  const settled = Date.parse(reading.blockTimestamp);
  if (Number.isNaN(sealed)) return mismatch("time", `settled at ${reading.blockTimestamp}; the recorded sealing time ${facts.finalizedAt} is not a time`);
  if (settled <= sealed) return match("time", `settled at ${reading.blockTimestamp}, before the receipt was sealed at ${facts.finalizedAt}`);
  return mismatch("time", `settled at ${reading.blockTimestamp}, after the receipt claims to have been sealed at ${facts.finalizedAt}`);
}

/** One Transfer of one token, from the signer; the shape of a transfer and a payout. */
function checkSingleTransfer(
  reading: ArcTransactionReading,
  usdc: CircleToken,
  amountText: string | null,
): { checks: Check[]; transfer: TokenTransfer | null } {
  const checks: Check[] = [];
  const transfers = tokenTransfers(reading, usdc);
  if (transfers.length !== 1) {
    checks.push(mismatch("transfers", `${transfers.length} USDC Transfer events in the transaction; the receipt records exactly one`));
    return { checks, transfer: null };
  }
  const [transfer] = transfers;
  checks.push(match("transfers", `exactly one USDC Transfer event, from the USDC contract ${short(usdc.address)}`));
  const expected = toBaseUnits(amountText, usdc.decimals);
  const moved = fromBaseUnits(transfer.amount, usdc.decimals);
  if (expected === null) checks.push(mismatch("amount", `${moved} USDC moved; the receipt's amount ${amountText ?? "(none)"} is not a USDC amount`));
  else if (expected === transfer.amount) checks.push(match("amount", `${moved} USDC moved, as recorded (${amountText})`));
  else checks.push(mismatch("amount", `${moved} USDC moved; the receipt records ${amountText}`));
  if (transfer.from === reading.from) checks.push(match("sender", "the USDC left the wallet that signed the transaction"));
  else checks.push(mismatch("sender", `the USDC left ${transfer.from}, not the signing wallet ${reading.from}`));
  return { checks, transfer };
}

function checkTransfer(facts: ReceiptFacts, reading: ArcTransactionReading, usdc: CircleToken): Check[] {
  const { checks } = checkSingleTransfer(reading, usdc, facts.amountIn);
  checks.push(notRecorded("recipient", "a transfer receipt records the amount and the transaction, not the recipient"));
  checks.push(...checkDecimals(reading, [usdc]));
  return checks;
}

/**
 * A payment a team received: one transfer of the requested asset, of the
 * recorded amount, from the wallet that signed — and, when the receipt file is
 * at hand, to the payee and from the payer it names.
 */
function checkReceived(facts: ReceiptFacts, reading: ArcTransactionReading, network: ArcNetwork): Check[] {
  const tokens = circleTokens(network);
  const asset = facts.received?.asset ?? "USDC";
  const token = tokens.find((entry) => entry.symbol === asset);
  if (!token) return [mismatch("asset", `${network.label} registers no ${asset}; the receipt records a payment in it`)];
  const { checks, transfer } = checkSingleTransfer(reading, token, facts.amountIn);
  const payee = facts.received?.payee ?? null;
  const payer = facts.received?.payer ?? null;
  if (transfer && payee) {
    if (transfer.to === payee) checks.push(match("recipient", `the ${token.symbol} reached the payee the receipt names`));
    else checks.push(mismatch("recipient", `the ${token.symbol} reached ${transfer.to}; the receipt names the payee ${payee}`));
  } else if (transfer) {
    checks.push(notRecorded("recipient", "the public summary does not name the payee; the receipt file does"));
  }
  if (payer) {
    if (reading.from === payer) checks.push(match("payer", "the payer the receipt names signed the transaction"));
    else checks.push(mismatch("payer", `the transaction was signed by ${reading.from}; the receipt names the payer ${payer}`));
  } else {
    checks.push(notRecorded("payer", "the public summary does not name the payer; the receipt file does"));
  }
  checks.push(...checkDecimals(reading, [token]));
  return checks;
}

function checkPayout(facts: ReceiptFacts, reading: ArcTransactionReading, usdc: CircleToken): Check[] {
  const payout = facts.payout;
  const checks: Check[] = [];
  const contract = payout?.contractAddress ?? usdc.address.toLowerCase();
  if (reading.to === contract) checks.push(match("contract", `the transaction called the USDC contract ${short(contract)} directly`));
  else checks.push(mismatch("contract", `the transaction called ${reading.to ?? "no contract"}; the payout is bound to ${contract}`));
  if (reading.valueWei === 0n) checks.push(match("value", "no native value was attached"));
  else checks.push(mismatch("value", `${fromBaseUnits(reading.valueWei, 18, false)} native USDC was attached; a payout attaches none`));

  const single = checkSingleTransfer(reading, usdc, payout?.amount ?? facts.amountIn);
  checks.push(...single.checks);
  const transfer = single.transfer;

  if (transfer && payout?.treasuryWalletAddress) {
    if (transfer.from === payout.treasuryWalletAddress && reading.from === payout.treasuryWalletAddress) {
      checks.push(match("treasury", "the treasury wallet the receipt names signed and paid"));
    } else {
      checks.push(mismatch("treasury", `the payment came from ${transfer.from}; the receipt names the treasury ${payout.treasuryWalletAddress}`));
    }
  } else if (transfer) {
    checks.push(notRecorded("treasury", "the public summary does not name the treasury wallet; the receipt file does"));
  }
  if (transfer && payout?.beneficiaryWalletAddress) {
    if (transfer.to === payout.beneficiaryWalletAddress) checks.push(match("recipient", "the USDC reached the beneficiary wallet the receipt names"));
    else checks.push(mismatch("recipient", `the USDC reached ${transfer.to}; the receipt names the beneficiary ${payout.beneficiaryWalletAddress}`));
  } else if (transfer) {
    checks.push(notRecorded("recipient", "the public summary does not name the recipient; the receipt file does"));
  }

  const recordedBlock = payout?.blockNumber ?? null;
  if (recordedBlock === null) {
    checks.push(notRecorded("block", `in block ${reading.blockNumber}; no block is recorded`));
  } else if (recordedBlock !== reading.blockNumber) {
    checks.push(mismatch("block", `in block ${reading.blockNumber}; the receipt records block ${recordedBlock}`));
  } else {
    const position: string[] = [];
    const wrong: string[] = [];
    const blockHash = payout?.blockHash ?? null;
    const transactionIndex = payout?.transactionIndex ?? null;
    const logIndex = payout?.logIndex ?? null;
    if (blockHash !== null) (blockHash === reading.blockHash ? position : wrong).push("block hash");
    if (transactionIndex !== null) (transactionIndex === reading.transactionIndex ? position : wrong).push("position in the block");
    if (logIndex !== null && transfer) (logIndex === transfer.logIndex ? position : wrong).push("event index");
    if (wrong.length > 0) checks.push(mismatch("block", `block ${reading.blockNumber} as recorded, but not its ${wrong.join(", ")}`));
    else checks.push(match("block", `in block ${reading.blockNumber}${position.length > 0 ? `, with the recorded ${position.join(", ")}` : ", as recorded"}`));
  }

  const amount = transfer?.amount ?? null;
  const fee = ceilToSixDecimals(reading.gasUsed * reading.effectiveGasPriceWei);
  const recordedDebit = payout?.actualTotalDebitBaseUnits ? BigInt(payout.actualTotalDebitBaseUnits) : null;
  const ceiling = payout?.maxTotalDebitBaseUnits ? BigInt(payout.maxTotalDebitBaseUnits) : null;
  if (amount !== null && recordedDebit !== null) {
    const debit = amount + fee;
    const shown = fromBaseUnits(debit, usdc.decimals);
    if (debit !== recordedDebit) checks.push(mismatch("debit", `${shown} USDC left the treasury with the fee; the receipt records ${fromBaseUnits(recordedDebit, usdc.decimals)}`));
    else if (ceiling !== null && debit > ceiling) checks.push(mismatch("debit", `${shown} USDC left the treasury with the fee, above the approved ceiling of ${fromBaseUnits(ceiling, usdc.decimals)}`));
    else checks.push(match("debit", `${shown} USDC left the treasury with the fee, as recorded${ceiling !== null ? `, within the approved ceiling of ${fromBaseUnits(ceiling, usdc.decimals)}` : ""}`));
  }
  checks.push(...checkDecimals(reading, [usdc]));
  return checks;
}

/** An exchange between the network's Circle tokens, judged by the wallet's net flows. */
function checkExchange(facts: ReceiptFacts, reading: ArcTransactionReading, network: ArcNetwork): Check[] {
  const checks: Check[] = [];
  const tokens = circleTokens(network);
  const wallet = reading.from;
  const flows = tokens.map((token) => ({ token, net: netFlow(reading, token, wallet) }));

  const named = (assetRef: string | null) => {
    const token = circleTokenAt(network, assetAddressOn(network, assetRef));
    return token ? tokens.find((entry) => entry.key === token.key) ?? null : null;
  };
  const sell = named(facts.swap?.sellAssetRef ?? null) ?? flows.find((flow) => flow.net < 0n)?.token ?? null;
  const buy = named(facts.swap?.buyAssetRef ?? null) ?? flows.find((flow) => flow.net > 0n && flow.token.key !== sell?.key)?.token ?? null;
  if (!sell || !buy || sell.key === buy.key) {
    checks.push(mismatch("exchange", "the signing wallet did not give up one Circle token and receive the other"));
    return checks;
  }
  const soldUnits = -(flows.find((flow) => flow.token.key === sell.key)?.net ?? 0n);
  const boughtUnits = flows.find((flow) => flow.token.key === buy.key)?.net ?? 0n;
  const expectedSold = toBaseUnits(facts.amountIn, sell.decimals);
  const expectedBought = toBaseUnits(facts.amountOut, buy.decimals);

  const soldShown = `${fromBaseUnits(soldUnits, sell.decimals)} ${sell.symbol}`;
  if (expectedSold === soldUnits) checks.push(match("sold", `${soldShown} left the signing wallet, as recorded (${facts.amountIn})`));
  else checks.push(mismatch("sold", `${soldShown} left the signing wallet; the receipt records ${facts.amountIn ?? "no amount"}`));

  const boughtShown = `${fromBaseUnits(boughtUnits, buy.decimals)} ${buy.symbol}`;
  if (expectedBought === boughtUnits) checks.push(match("bought", `${boughtShown} arrived in the signing wallet, as recorded (${facts.amountOut})`));
  else checks.push(mismatch("bought", `${boughtShown} arrived in the signing wallet; the receipt records ${facts.amountOut ?? "no amount"}`));

  const minimum = toBaseUnits(facts.minimumAmountOut, buy.decimals);
  if (minimum === null) checks.push(notRecorded("minimum", "no approved minimum is recorded"));
  else if (boughtUnits >= minimum) checks.push(match("minimum", `at least the approved minimum of ${facts.minimumAmountOut} ${buy.symbol} arrived`));
  else checks.push(mismatch("minimum", `${boughtShown} arrived, below the approved minimum of ${facts.minimumAmountOut} ${buy.symbol}`));

  checks.push(...checkDecimals(reading, [sell, buy]));
  return checks;
}

/** The wallet's net movement of the token at this address in this transaction: in minus out. */
function flowOf(reading: ArcTransactionReading, address: string, wallet: string): bigint {
  const wanted = address.toLowerCase();
  let net = 0n;
  for (const transfer of reading.transfers) {
    if (transfer.token !== wanted) continue;
    if (transfer.to === wallet) net += transfer.amount;
    if (transfer.from === wallet) net -= transfer.amount;
  }
  return net;
}

/**
 * A swap through an aggregator's router (1.9.0): the router the receipt names
 * was called, what left the signing wallet and what reached it are the
 * recorded amounts, at least the signed floor arrived, and Ryntra's fee is a
 * Transfer of exactly the recorded amount in the same transaction.
 */
function checkRouteSwap(facts: ReceiptFacts, reading: ArcTransactionReading, network: ArcNetwork, route: SwapRouteFacts): Check[] {
  const checks: Check[] = [];
  const wallet = reading.from;
  if (route.router === null) checks.push(notRecorded("router", `the transaction called ${reading.to ?? "no contract"}; the summary names no router`));
  else if (reading.to === route.router) checks.push(match("router", `the transaction called the router the receipt names, ${short(route.router)}`));
  else checks.push(mismatch("router", `the transaction called ${reading.to ?? "no contract"}; the receipt names the router ${route.router}`));
  if (reading.valueWei === 0n) checks.push(match("value", "no native value was attached"));
  else checks.push(mismatch("value", `${fromBaseUnits(reading.valueWei, 18, false)} native USDC was attached; a swap of tokens attaches none`));

  const sold = -flowOf(reading, route.tokenIn.address, wallet);
  const soldShown = `${fromBaseUnits(sold < 0n ? 0n : sold, route.tokenIn.decimals)} ${route.tokenIn.symbol}`;
  if (toBaseUnits(facts.amountIn, route.tokenIn.decimals) === sold) checks.push(match("sold", `${soldShown} left the signing wallet, as recorded (${facts.amountIn})`));
  else checks.push(mismatch("sold", `${soldShown} left the signing wallet; the receipt records ${facts.amountIn ?? "no amount"}`));

  const bought = flowOf(reading, route.tokenOut.address, wallet);
  const boughtShown = `${fromBaseUnits(bought < 0n ? 0n : bought, route.tokenOut.decimals)} ${route.tokenOut.symbol}`;
  if (toBaseUnits(facts.amountOut, route.tokenOut.decimals) === bought) checks.push(match("bought", `${boughtShown} arrived in the signing wallet, as recorded (${facts.amountOut})`));
  else checks.push(mismatch("bought", `${boughtShown} arrived in the signing wallet; the receipt records ${facts.amountOut ?? "no amount"}`));

  const minimum = toBaseUnits(facts.minimumAmountOut, route.tokenOut.decimals);
  if (minimum === null) checks.push(notRecorded("minimum", "no signed floor is recorded"));
  else if (bought >= minimum) checks.push(match("minimum", `at least the signed floor of ${facts.minimumAmountOut} ${route.tokenOut.symbol} arrived`));
  else checks.push(mismatch("minimum", `${boughtShown} arrived, below the signed floor of ${facts.minimumAmountOut} ${route.tokenOut.symbol}`));

  if (route.fee === null) {
    checks.push(notRecorded("ryntra-fee", "the receipt states no fee of Ryntra's"));
  } else if (toBaseUnits(route.fee.amount, route.fee.token.decimals) === 0n) {
    /* The receipt itself says the fee was not collected: there is no Transfer to look for. */
    checks.push(notRecorded("ryntra-fee", "the receipt records that no fee of Ryntra's was collected in this transaction"));
  } else {
    const units = toBaseUnits(route.fee.amount, route.fee.token.decimals);
    const token = route.fee.token.address.toLowerCase();
    const paid = units !== null && reading.transfers.some((transfer) => transfer.token === token && transfer.amount === units && transfer.to !== wallet);
    if (paid) checks.push(match("ryntra-fee", `a Transfer of exactly ${route.fee.amount} ${route.fee.token.symbol} left in this transaction, Ryntra's fee as recorded`));
    else checks.push(mismatch("ryntra-fee", `no Transfer of ${route.fee.amount} ${route.fee.token.symbol} in this transaction; the receipt records it as Ryntra's fee`));
  }
  const circle = [circleTokenAt(network, route.tokenIn.address), circleTokenAt(network, route.tokenOut.address)].filter(
    (token): token is CircleToken => token !== null,
  );
  checks.push(...checkDecimals(reading, circle));
  return checks;
}

/** Whether a transfer receipt's own amounts describe an exchange rather than a payment. */
export function isExchangeShaped(facts: ReceiptFacts): boolean {
  return facts.kind === "SWAP" || (facts.amountOut !== null && facts.amountIn !== null && facts.amountOut !== facts.amountIn);
}

/**
 * Every check of one receipt against one reading of its transaction.
 *
 * The caller has already matched the network to the receipt's chain and the
 * reading to the receipt's transaction hash; an empty list means this kind is
 * not read back from Arc here.
 */
export function checkAgainstArc(facts: ReceiptFacts, reading: ArcTransactionReading, network: ArcNetwork): Check[] {
  if (!CHECKED_KINDS.includes(facts.kind)) return [];
  const usdc = circleTokens(network)[0];
  const checks: Check[] = [
    match("chain", `the transaction is on ${network.label} (chain id ${reading.chainId}), the chain the receipt names`),
  ];
  checks.push(
    reading.status === "success"
      ? match("status", "the transaction succeeded")
      : mismatch("status", "the transaction reverted; the receipt records a confirmed settlement"),
  );
  if (facts.kind === "PAYOUT") checks.push(...checkPayout(facts, reading, usdc));
  else if (facts.kind === "RECEIVED") checks.push(...checkReceived(facts, reading, network));
  else if (facts.swap?.route) checks.push(...checkRouteSwap(facts, reading, network, facts.swap.route));
  else if (isExchangeShaped(facts)) checks.push(...checkExchange(facts, reading, network));
  else checks.push(...checkTransfer(facts, reading, usdc));
  checks.push(checkFee(facts, reading));
  checks.push(checkTime(facts, reading));
  return checks;
}
