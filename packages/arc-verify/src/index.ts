/**
 * @ryntra/arc-verify — check a Ryntra settlement receipt yourself.
 *
 * - **Schema** — `schema/receipt.schema.json`, JSON Schema 2020-12, generated
 *   from the receipt schema the product validates with.
 * - **Canonical serialization and seals** — the product's own functions,
 *   imported rather than copied (`canonical.ts`).
 * - **The receipt as a document** — its references, its chain, both seals
 *   recomputed, the public summary (`receipt.ts`). Ryntra's receipt verifier
 *   route imports them from this module.
 * - **The chain** — one transaction read from Arc's published JSON-RPC
 *   endpoints, compared across two of them (`chain.ts`), and every fact of a
 *   transfer, payout or exchange receipt held against it (`check.ts`).
 * - **The verdict** — `verifyReceipt` and the `arc-verify` command line
 *   (`verify.ts`, `cli.ts`).
 *
 * Read-only throughout: nothing here holds a key, signs or sends.
 */

export {
  RECEIPT_HASH_DOMAINS,
  canonicalJson,
  canonicalize,
  compareCanonicalStrings,
  hashCanonical,
  hashReceiptCore,
} from "./canonical.ts";
export type { JsonValue } from "./canonical.ts";

export {
  RECEIPT_KINDS,
  RECEIPT_SCHEMA_VERSIONS,
  chainRefOf,
  checkSeal,
  normalizeReceiptReference,
  publicReceiptDetail,
  publicSummary,
  receiptKind,
  receiptPrivateValues,
  referencesOf,
} from "./receipt.ts";
export type {
  HashCheck,
  Json,
  PublicPayoutDetail,
  PublicReceiptDetail,
  PublicReceiptSummary,
  PublicSwapDetail,
  ReceiptKind,
  SealOutcome,
  SealReport,
  VerifierVerdict,
} from "./receipt.ts";

export {
  ARC_MAINNET_NETWORK,
  ARC_NETWORKS,
  ARC_TESTNET_NETWORK,
  arcNetworkForChainRef,
  assetAddressOn,
  circleTokenAt,
  circleTokens,
  readEndpoints,
} from "./networks.ts";
export type { ArcNetwork, ArcTokenDefinition, CircleToken } from "./networks.ts";

export { ERC20_TRANSFER_TOPIC, RpcError, decodeTransfers, jsonRpc, readArcTransaction, readingsConflict } from "./chain.ts";
export type { ArcReadOutcome, ArcTransactionReading, EndpointNote, RpcCall, TokenTransfer } from "./chain.ts";

export {
  CHECKED_KINDS,
  ceilToSixDecimals,
  checkAgainstArc,
  factsFromReceipt,
  factsFromSummary,
  fromBaseUnits,
  isExchangeShaped,
  toBaseUnits,
} from "./check.ts";
export type { Check, CheckStatus, PayoutFacts, ReceiptFacts, SwapFacts } from "./check.ts";

export { DEFAULT_VERIFIER, askVerifier, readVerifierAnswer } from "./verifier.ts";
export type { VerifierAnswer } from "./verifier.ts";

export { verifyReceipt } from "./verify.ts";
export type { Verdict, VerificationReport, VerifyOptions } from "./verify.ts";
