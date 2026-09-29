/**
 * Kyber's fee paid back to the signer, proved without an ABI dependency.
 * One pinned router call, one matching Fee event and one actual ERC-20
 * Transfer must agree. Wallet amounts stay net; this proof never invents a fee.
 */
export const KYBER_ROUTER_ON_ARC = "0x6131b5fae19ea4f9d964eac0408e4408b66337b5";
const KYBER_EXECUTOR_ON_ARC = "0x8f10b468b06c6fd214b65f87778827f7d113f996";
const SWAP_SELECTOR = "0xe21fd0e9";
export const KYBER_FEE_TOPIC = "0x4c39b7ce5f4f514f45cb6f82b171b8b0b7f2cbf488ad28e4eff451588e2f014b";
export const KYBER_SELF_FEE_LIMITATION = "KYBERSWAP_FEE_RECIPIENT_IS_THE_SIGNING_WALLET";

export type KyberFeeLog = Readonly<{ address: string; topics: readonly string[]; data: string }>;
export type KyberFeeTransfer = Readonly<{ token: string; from: string; to: string; amount: bigint }>;
export type KyberFeeCall = Readonly<{
  tokenIn: string; tokenOut: string; recipient: string; amountIn: bigint;
  minimumOut: bigint; recipientFee: string; bps: number; side: "IN" | "OUT";
}>;

function body(value: unknown): string | null {
  return typeof value === "string" && /^0x(?:[0-9a-fA-F]{2})*$/.test(value) && value.length <= 2_000_010
    ? value.slice(2).toLowerCase() : null;
}
function word(data: string, at: number): string {
  if (!Number.isSafeInteger(at) || at < 0 || at * 2 + 64 > data.length) throw new Error("short ABI word");
  return data.slice(at * 2, at * 2 + 64);
}
function uint(data: string, at: number): bigint { return BigInt("0x" + word(data, at)); }
function address(data: string, at: number): string {
  const value = word(data, at);
  if (!/^0{24}[0-9a-f]{40}$/.test(value)) throw new Error("invalid address word");
  return "0x" + value.slice(24);
}
function offset(data: string, base: number, slot: number, head: number): number {
  const value = uint(data, base + slot * 32);
  if (value < BigInt(head) || value % 32n !== 0n || value > BigInt(data.length / 2)) throw new Error("invalid ABI offset");
  const at = base + Number(value);
  word(data, at);
  return at;
}

/** Decode only the fee-bearing swap shape supported by this product. */
export function readKyberFeeCall(input: unknown): KyberFeeCall | null {
  if (typeof input !== "string" || input.slice(0, 10).toLowerCase() !== SWAP_SELECTOR) return null;
  const data = body("0x" + input.slice(10));
  if (data === null) return null;
  try {
    if (uint(data, 0) !== 32n) return null;
    const execution = 32;
    if (address(data, execution) !== KYBER_EXECUTOR_ON_ARC || address(data, execution + 32) !== "0x" + "0".repeat(40)) return null;
    const desc = offset(data, execution, 3, 160);
    const recipients = offset(data, desc, 4, 352);
    const amounts = offset(data, desc, 5, 352);
    if (uint(data, recipients) !== 1n || uint(data, amounts) !== 1n) return null;
    const flags = uint(data, desc + 9 * 32);
    if ((flags & 128n) === 0n || (flags & ~736n) !== 0n) return null;
    const permit = offset(data, desc, 10, 352);
    if (uint(data, permit) !== 0n) return null;
    const rate = uint(data, amounts + 32);
    if (rate < 1n || rate > 100n) return null;
    return {
      tokenIn: address(data, desc), tokenOut: address(data, desc + 32),
      recipient: address(data, desc + 6 * 32), amountIn: uint(data, desc + 7 * 32),
      minimumOut: uint(data, desc + 8 * 32), recipientFee: address(data, recipients + 32),
      bps: Number(rate), side: (flags & 64n) !== 0n ? "OUT" : "IN",
    };
  } catch { return null; }
}

type Fee = Readonly<{ token: string; totalAmount: bigint; totalFee: bigint; recipient: string; bps: number }>;
function feeEvent(log: KyberFeeLog): Fee | null {
  const data = body(log.data);
  if (data === null || data.length !== 640 || log.topics.length !== 1) return null;
  try {
    /* Canonical heads and exactly one recipient/rate: no aliased or extra arrays. */
    if (uint(data, 96) !== 192n || uint(data, 128) !== 256n ||
        uint(data, 160) !== 1n || uint(data, 192) !== 1n || uint(data, 256) !== 1n) return null;
    const rate = uint(data, 288);
    if (rate < 1n || rate > 100n) return null;
    return { token: address(data, 0), totalAmount: uint(data, 32), totalFee: uint(data, 64), recipient: address(data, 224), bps: Number(rate) };
  } catch { return null; }
}

export type KyberSelfFeeProof =
  | Readonly<{ proven: false; reason: string }>
  | Readonly<{ proven: true; amount: bigint; side: "IN" | "OUT"; bps: number; minimumOut: bigint; grossInput: bigint }>;

export function proveKyberSelfFee(input: Readonly<{
  router: string | null; calldata: string | null; wallet: string;
  tokenIn: string; tokenOut: string; bps: number | null; side: "IN" | "OUT" | null;
  debited: bigint; credited: bigint; recordedFee?: bigint;
  logs: readonly KyberFeeLog[] | null; transfers: readonly KyberFeeTransfer[];
}>): KyberSelfFeeProof {
  const no = (reason: string): KyberSelfFeeProof => ({ proven: false, reason });
  if (input.router?.toLowerCase() !== KYBER_ROUTER_ON_ARC) return no("ROUTER_NOT_KYBERSWAP");
  const call = readKyberFeeCall(input.calldata);
  if (!call) return no("FEE_CALLDATA_UNREADABLE");
  const wallet = input.wallet.toLowerCase();
  if (call.recipientFee !== wallet || call.recipient !== wallet) return no("FEE_NOT_TO_SIGNER");
  if (call.tokenIn !== input.tokenIn.toLowerCase() || call.tokenOut !== input.tokenOut.toLowerCase() ||
      call.side !== input.side || call.bps !== input.bps) return no("FEE_CALLDATA_DIFFERS");
  const logs = input.logs?.filter((log) => log.address.toLowerCase() === KYBER_ROUTER_ON_ARC && log.topics[0]?.toLowerCase() === KYBER_FEE_TOPIC);
  if (!logs || logs.length !== 1) return no(logs?.length ? "FEE_EVENTS_AMBIGUOUS" : "FEE_EVENT_MISSING");
  const fee = feeEvent(logs[0]);
  if (!fee) return no("FEE_EVENT_UNREADABLE");
  const token = call.side === "IN" ? call.tokenIn : call.tokenOut;
  if (fee.token !== token || fee.recipient !== wallet || fee.bps !== call.bps ||
      fee.totalAmount <= 0n || fee.totalFee <= 0n ||
      fee.totalFee !== fee.totalAmount * BigInt(fee.bps) / 10_000n) return no("FEE_EVENT_DIFFERS");
  if (input.recordedFee !== undefined && fee.totalFee !== input.recordedFee) return no("FEE_AMOUNT_DIFFERS");
  const matching = input.transfers.filter((transfer) =>
    transfer.token.toLowerCase() === token && transfer.to.toLowerCase() === wallet &&
    transfer.amount === fee.totalFee &&
    (transfer.from.toLowerCase() === KYBER_ROUTER_ON_ARC || (call.side === "IN" && transfer.from.toLowerCase() === wallet)));
  if (matching.length !== 1) return no(matching.length ? "FEE_TRANSFERS_AMBIGUOUS" : "FEE_TRANSFER_MISSING");
  if (call.side === "IN") {
    if (fee.totalAmount !== call.amountIn || input.debited + fee.totalFee !== call.amountIn) return no("FEE_INPUT_ACCOUNTING_DIFFERS");
  } else {
    if (input.debited !== call.amountIn || input.credited !== fee.totalAmount) return no("FEE_OUTPUT_ACCOUNTING_DIFFERS");
  }
  return { proven: true, amount: fee.totalFee, side: call.side, bps: call.bps, minimumOut: call.minimumOut, grossInput: call.amountIn };
}
