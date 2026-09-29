/**
 * What kind of receipt is this, and what may a stranger be told about it?
 *
 * The Public Receipt Verifier answers for anyone holding a reference — no
 * account, no session, no tenant. Until now it answered with one shape for
 * every receipt, which was correct and thin: the same six amounts whether the
 * record was a transfer, a swap, a payout or a crosschain move. A reader
 * holding a swap receipt could not see what the route cost; a reader holding a
 * bridge receipt could not see whether the money had arrived.
 *
 * So there are two functions here and the split is the whole design.
 *
 * `receiptKind` reads the schema version and the blocks present. It never
 * guesses: a record whose version this deployment does not know is
 * `UNKNOWN`, and an unknown kind gets the common projection rather than a
 * kind-specific one built out of hope.
 *
 * `publicReceiptDetail` returns the extra, kind-specific fields — and it is an
 * **allowlist assembled field by field**, never a redaction pass over the
 * block. The difference matters: a redaction pass leaks whatever a later
 * version adds, and an allowlist omits it. A payout block, for example, carries
 * the beneficiary and treasury addresses; nothing from it reaches this
 * projection at all.
 *
 * ## What never leaves, in any kind
 *
 * Tenant, requester, approver references, evidence item refs, wallet addresses,
 * beneficiary references and policy identifiers. `redactDecisionSettlementReceipt`
 * strips principals but keeps `tenantId`, which is right for an authenticated
 * export and wrong here — two references would tell a stranger they belong to
 * one workspace.
 */

export const RECEIPT_KINDS = ["TRANSFER", "SWAP", "PAYOUT", "BRIDGE", "RECEIVED", "UNKNOWN"] as const;

export type ReceiptKind = (typeof RECEIPT_KINDS)[number];

type Json = Record<string, unknown>;

function object(value: unknown): Json | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Json) : null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function integer(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) ? value : null;
}

function bool(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

/**
 * The kind, read from the record rather than assumed from the surface.
 *
 * Version and block are both checked. A `1.2.0` without a payout block is not a
 * payout — the schema forbids it, and a store holding one is holding something
 * this function should not describe as a payout on the strength of a version
 * string alone.
 */
export function receiptKind(record: Json): ReceiptKind {
  const version = text(record.schemaVersion);
  /* A payment a team received through its request (Arc 11,
     `lib/guard/arc-received-receipt.ts`): its own record, resting on the
     payer's transfer receipt. */
  if (version === "1.6.0" && object(record.received)) return "RECEIVED";
  /* 1.4.0 is a planned bridge on Arc's testnet; 1.7.0 a transfer into or out
     of Arc read on both chains (Arc 14, `lib/arc/bridge/receipt.ts`). */
  if ((version === "1.4.0" || version === "1.7.0") && object(record.bridge)) return "BRIDGE";
  /* 1.8.0 is a route on any of the bridge's rails, with our fee as its own line (Arc 44). */
  if (version === "1.8.0" && object(record.route)) return "BRIDGE";
  if (version === "1.3.0" && object(record.swap)) return "SWAP";
  if (version === "1.2.0" && object(record.payout)) return "PAYOUT";
  if (version === "1.0.0" || version === "1.1.0") return "TRANSFER";
  return "UNKNOWN";
}

export type PublicSwapDetail = Readonly<{
  provider: string | null;
  routeDisclosure: string | null;
  slippageBps: string | null;
  quotedNetworkFee: string | null;
  quotedRouteFee: string | null;
  quotedTotalFee: string | null;
  quotedFeeCoverage: string | null;
  settledNetworkFee: string | null;
  settledNetworkFeeSource: string | null;
  settledRouteFee: string | null;
  settledRouteFeeSource: string | null;
  settledRouteObservability: string | null;
  authorizedCeiling: string | null;
  settledTotalDebit: string | null;
  authorizedMinimumAmountOut: string | null;
  deviations: readonly string[];
}>;

export type PublicPayoutDetail = Readonly<{
  purposeCode: string | null;
  amount: string | null;
  requiredApprovalCount: number | null;
  receivedApprovalCount: number | null;
  maxTotalDebit: string | null;
  actualTotalDebit: string | null;
  confirmations: number | null;
  blockNumber: number | null;
}>;

export type PublicBridgeDetail = Readonly<{
  protocol: string | null;
  sourceLabel: string | null;
  sourceDomain: number | null;
  destinationLabel: string | null;
  destinationDomain: number | null;
  speed: string | null;
  finalityThreshold: number | null;
  sourceTransactionHash: string | null;
  attestationStatus: string | null;
  attestationObservedAt: string | null;
  destinationEvidenceKind: string | null;
  destinationTransactionHash: string | null;
  destinationAbsentReason: string | null;
  authorized: string | null;
  sourceDebited: string | null;
  destinationCredited: string | null;
  transportCost: string | null;
  authorizedMaxFee: string | null;
  quotedTransportFee: string | null;
  quotedTransportFeeSource: string | null;
  sourceNetworkFee: string | null;
  elapsedMs: number | null;
  lifecycleState: string | null;
  whereTheValueIs: string | null;
  fundsAtRest: boolean | null;
  deviations: readonly string[];
  /* Transfers into and out of Arc (1.7.0) say which way, which asset and who
     delivered; null on the testnet's planned bridge (1.4.0). */
  direction: string | null;
  asset: string | null;
  deliveredBy: string | null;
  sourceExplorerUrl: string | null;
  destinationExplorerUrl: string | null;
  /* A route (1.8.0) names its rail, what the quote promised, and Ryntra's fee
     as its own line; null on 1.4.0 and 1.7.0. */
  rail: string | null;
  quotedReceive: string | null;
  ryntraFee: Readonly<{
    bps: number | null;
    mechanism: string | null;
    state: string | null;
    quoted: string | null;
    actual: string | null;
    asset: string | null;
    evidence: string | null;
  }> | null;
}>;

export type PublicReceivedDetail = Readonly<{
  asset: string | null;
  amount: string | null;
  paidAt: string | null;
  /** The payer's transfer receipt this one rests on — checkable on its own. */
  payerReceiptId: string | null;
  matchedBy: string | null;
}>;

export type PublicReceiptDetail =
  | Readonly<{ kind: "TRANSFER"; detail: null }>
  | Readonly<{ kind: "UNKNOWN"; detail: null }>
  | Readonly<{ kind: "SWAP"; detail: PublicSwapDetail }>
  | Readonly<{ kind: "PAYOUT"; detail: PublicPayoutDetail }>
  | Readonly<{ kind: "BRIDGE"; detail: PublicBridgeDetail }>
  | Readonly<{ kind: "RECEIVED"; detail: PublicReceivedDetail }>;

function strings(value: unknown): readonly string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

export function publicReceiptDetail(record: Json): PublicReceiptDetail {
  const kind = receiptKind(record);

  if (kind === "SWAP") {
    const swap = object(record.swap) ?? {};
    const quoted = object(swap.quotedFees) ?? {};
    const settled = object(swap.settledFees) ?? {};
    const debit = object(swap.debit) ?? {};
    return {
      kind,
      detail: {
        provider: text(swap.provider),
        routeDisclosure: text(swap.routeDisclosure),
        slippageBps: text(swap.slippageBps),
        quotedNetworkFee: text(quoted.networkAmount),
        quotedRouteFee: text(quoted.routeAmount),
        quotedTotalFee: text(quoted.totalAmount),
        quotedFeeCoverage: text(quoted.coverage),
        settledNetworkFee: text(settled.networkAmount),
        settledNetworkFeeSource: text(settled.networkSource),
        settledRouteFee: text(settled.routeAmount),
        settledRouteFeeSource: text(settled.routeSource),
        settledRouteObservability: text(settled.routeObservability),
        authorizedCeiling: text(debit.authorizedCeiling),
        settledTotalDebit: text(debit.settledTotal),
        authorizedMinimumAmountOut: text(swap.authorizedMinimumAmountOut),
        deviations: strings(swap.deviations),
      },
    };
  }

  if (kind === "PAYOUT") {
    /* The narrowest projection of the four, and deliberately so. A payout block
       carries the beneficiary address, the treasury address, the beneficiary
       version reference and the requester and approver principals. None of them
       is here: what a stranger may check about a payout is that it happened,
       under how many approvals, for how much, and against which ceiling. */
    const payout = object(record.payout) ?? {};
    const provenance = object(payout.provenance) ?? {};
    return {
      kind,
      detail: {
        purposeCode: text(payout.purposeCode),
        amount: text(payout.amount),
        requiredApprovalCount: integer(payout.requiredApprovalCount),
        receivedApprovalCount: integer(payout.receivedApprovalCount),
        maxTotalDebit: text(payout.maxTotalDebitBaseUnits),
        actualTotalDebit: text(payout.actualTotalDebitBaseUnits),
        confirmations: integer(provenance.confirmations),
        blockNumber: integer(provenance.blockNumber),
      },
    };
  }

  if (kind === "BRIDGE" && text(record.schemaVersion) === "1.8.0") {
    /* A route on one of the bridge's rails (Arc 44). The wallets stay out, as
       every kind's do; the two transactions, the rail and our fee as its own
       line are the point of the receipt. */
    const route = object(record.route) ?? {};
    const source = object(route.source) ?? {};
    const destination = object(route.destination) ?? {};
    const attestation = object(route.attestation) ?? {};
    const quote = object(route.quote) ?? {};
    const provider = object(route.provider) ?? {};
    const providerFee = object(route.providerFee) ?? {};
    const fee = object(route.ryntraFee);
    const quoted = object(fee?.quoted) ?? {};
    const actual = object(fee?.actual) ?? {};
    const actualFx = object(record.actualEffects) ?? {};
    return {
      kind,
      detail: {
        protocol: text(provider.name),
        sourceLabel: text(source.label),
        sourceDomain: null,
        destinationLabel: text(destination.label),
        destinationDomain: null,
        speed: null,
        finalityThreshold: integer(attestation.finalityThresholdExecuted),
        sourceTransactionHash: text(source.transactionHash),
        attestationStatus: object(route.attestation) ? "complete" : null,
        attestationObservedAt: text(attestation.observedAt),
        destinationEvidenceKind: "CHAIN_RECEIPT",
        destinationTransactionHash: text(destination.transactionHash),
        destinationAbsentReason: null,
        authorized: text(source.amount),
        sourceDebited: text(source.amount),
        destinationCredited: text(destination.amount),
        transportCost: text(actualFx.feeAmount),
        authorizedMaxFee: null,
        quotedTransportFee: text(providerFee.amount) ?? text(providerFee.usd),
        quotedTransportFeeSource: text(quote.source),
        sourceNetworkFee: null,
        elapsedMs: null,
        lifecycleState: "RECEIPT_ISSUED",
        whereTheValueIs: "DESTINATION_WALLET",
        fundsAtRest: true,
        deviations: strings(route.deviations),
        direction: text(route.direction),
        asset: text(object(destination.token)?.symbol),
        deliveredBy: text(provider.name),
        sourceExplorerUrl: text(source.explorerUrl),
        destinationExplorerUrl: text(destination.explorerUrl),
        rail: text(route.rail),
        quotedReceive: text(quote.expectedOut),
        ryntraFee: fee
          ? {
              bps: integer(fee.bps),
              mechanism: text(fee.mechanism),
              state: text(fee.state),
              quoted: text(quoted.amount) ?? text(quoted.usd),
              actual: text(actual.amount) ?? text(actual.usd),
              asset: text(actual.asset) ?? text(quoted.asset),
              evidence: text(fee.evidence),
            }
          : null,
      },
    };
  }

  if (kind === "BRIDGE" && text(record.schemaVersion) === "1.7.0") {
    /* A transfer read on both chains. The sender and the recipient are wallet
       addresses and stay out, as every kind's wallets do; the two transactions
       are public on their chains and are the point of the receipt. */
    const bridge = object(record.bridge) ?? {};
    const source = object(bridge.source) ?? {};
    const destination = object(bridge.destination) ?? {};
    const attestation = object(bridge.attestation) ?? {};
    const amounts = object(bridge.amounts) ?? {};
    const plan = object(bridge.plan) ?? {};
    const deviations = strings(bridge.deviations);
    return {
      kind,
      detail: {
        protocol: text(bridge.protocol),
        sourceLabel: text(source.label),
        sourceDomain: integer(source.domain),
        destinationLabel: text(destination.label),
        destinationDomain: integer(destination.domain),
        speed: text(bridge.speed),
        finalityThreshold: integer(bridge.finalityThreshold),
        sourceTransactionHash: text(source.transactionHash),
        attestationStatus: text(attestation.status),
        attestationObservedAt: text(attestation.observedAt),
        destinationEvidenceKind: "CHAIN_RECEIPT",
        destinationTransactionHash: text(destination.transactionHash),
        destinationAbsentReason: null,
        authorized: text(amounts.sent),
        sourceDebited: text(amounts.sent),
        destinationCredited: text(amounts.received),
        transportCost: text(amounts.fee),
        authorizedMaxFee: text(amounts.maxFee),
        quotedTransportFee: text(amounts.maxFee),
        quotedTransportFeeSource: text(plan.feeSource),
        /* Paid in the source network's own coin, not in the asset: not a figure to set beside the amounts. */
        sourceNetworkFee: null,
        elapsedMs: null,
        lifecycleState: "RECEIPT_ISSUED",
        whereTheValueIs: "DESTINATION_WALLET",
        fundsAtRest: true,
        deviations,
        direction: text(bridge.direction),
        asset: text(bridge.asset),
        deliveredBy: text(destination.deliveredBy),
        sourceExplorerUrl: text(source.explorerUrl),
        destinationExplorerUrl: text(destination.explorerUrl),
        rail: "CIRCLE",
        quotedReceive: text(amounts.receiveAtLeast),
        ryntraFee: null,
      },
    };
  }

  if (kind === "BRIDGE") {
    const bridge = object(record.bridge) ?? {};
    const source = object(bridge.source) ?? {};
    const destination = object(bridge.destination) ?? {};
    const attestation = object(bridge.attestation) ?? {};
    const effect = object(bridge.destinationEffect) ?? {};
    const amounts = object(bridge.amounts) ?? {};
    const fees = object(bridge.fees) ?? {};
    const duration = object(bridge.duration) ?? {};
    const recovery = object(bridge.recovery) ?? {};
    return {
      kind,
      detail: {
        protocol: text(bridge.protocol),
        sourceLabel: text(source.label),
        sourceDomain: integer(source.domain),
        destinationLabel: text(destination.label),
        destinationDomain: integer(destination.domain),
        speed: text(bridge.speed),
        finalityThreshold: integer(bridge.finalityThreshold),
        sourceTransactionHash: text(bridge.sourceTransactionHash),
        attestationStatus: text(attestation.providerStatus),
        attestationObservedAt: text(attestation.observedAt),
        destinationEvidenceKind: text(effect.evidenceKind),
        destinationTransactionHash: text(effect.transactionHash),
        destinationAbsentReason: text(effect.absentReason),
        authorized: text(amounts.authorized),
        sourceDebited: text(amounts.sourceDebited),
        destinationCredited: text(amounts.destinationCredited),
        transportCost: text(amounts.transportCost),
        authorizedMaxFee: text(fees.authorizedMaxFee),
        quotedTransportFee: text(fees.quotedTransportFee),
        quotedTransportFeeSource: text(fees.quotedTransportFeeSource),
        sourceNetworkFee: text(fees.sourceNetworkFee),
        elapsedMs: integer(duration.elapsedMs),
        lifecycleState: text(bridge.lifecycleState),
        whereTheValueIs: text(recovery.whereTheValueIs),
        fundsAtRest: bool(recovery.fundsAtRest),
        deviations: strings(bridge.deviations),
        direction: null,
        asset: null,
        deliveredBy: null,
        sourceExplorerUrl: null,
        destinationExplorerUrl: null,
        rail: null,
        quotedReceive: null,
        ryntraFee: null,
      },
    };
  }

  if (kind === "RECEIVED") {
    /* Private by default (CANON §5, п. 9): who asked, who paid, where to, for
       what and under which invoice number stay with the team. A stranger
       holding the reference learns that a payment of this much arrived, when,
       and which transfer receipt it rests on. */
    const received = object(record.received) ?? {};
    const payerReceipt = object(received.payerReceipt) ?? {};
    return {
      kind,
      detail: {
        asset: text(received.asset),
        amount: text(received.amount),
        paidAt: text(received.paidAt),
        payerReceiptId: text(payerReceipt.id),
        matchedBy: text(received.matchedBy),
      },
    };
  }

  return { kind, detail: null };
}

/**
 * Values that must never appear in a public projection, whatever the kind.
 *
 * Exported so the test and the route read the same list, and written as
 * extractors rather than as a denylist of strings: a denylist over serialized
 * JSON passes the moment somebody renames a field, and this asks the record
 * itself what its secrets are and then checks the projection for them.
 */
export function receiptPrivateValues(record: Json): readonly string[] {
  const payout = object(record.payout) ?? {};
  const authorization = object(record.authorization) ?? {};
  const evidence = object(record.evidence) ?? {};
  const received = object(record.received) ?? {};
  const bridge = object(record.bridge) ?? {};
  const route = object(record.route) ?? {};
  return [
    /* A transfer's two wallets (1.7.0), and a route's (1.8.0). */
    text(object(bridge.source)?.sender),
    text(object(bridge.destination)?.recipient),
    text(object(route.source)?.sender),
    text(object(route.destination)?.recipient),
    text(received.payee),
    text(received.payer),
    text(received.requestId),
    text(received.purpose),
    text(received.reference),
    text(record.tenantId),
    text(authorization.subjectRef),
    text(authorization.id),
    text(payout.beneficiaryWalletAddress),
    text(payout.treasuryWalletAddress),
    text(payout.beneficiaryRef),
    text(payout.requesterRef),
    ...(Array.isArray(payout.approverRefs) ? payout.approverRefs.filter((entry): entry is string => typeof entry === "string") : []),
    ...strings(evidence.refs),
  ].filter((value): value is string => value !== null);
}
