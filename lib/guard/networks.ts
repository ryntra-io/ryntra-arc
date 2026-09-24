/**
 * Arc network registry.
 *
 * Everything that differs between one Arc network and another lives here as
 * data: chain id, RPC endpoints, explorer, token addresses, decimals, and
 * whether the network carries real value. Nothing downstream may hard-code a
 * network fact.
 *
 * This is not tidiness. Two separate defects in one session came from network
 * facts typed by hand: an RPC host that a whole country cannot reach, and a
 * chain id whose hex digits were transposed into a chain that does not exist.
 * Both were invisible to the type system and one of them was enshrined by a
 * test. Derived-from-one-source is the only shape that removes that class.
 *
 * It is also what makes the product honest about its future. Adding mainnet is
 * a registry entry, not a rewrite. What a registry entry is *not* is the
 * permission to move real money: mainnet is a `CANARY` network. It can be
 * selected only by a deployment that names it, and on that deployment every
 * send is still closed until the operator opens the kill switch, capped per
 * action by code, and limited to allowlisted wallets
 * (`lib/guard/arc-mainnet-canary.ts`). The registry is the mechanism; the gate
 * is the permission.
 */

export type ArcNetworkStatus =
  /** Configured, verified and selectable. */
  | "ACTIVE"
  /**
   * Configured from verified official sources and selectable by a deployment
   * that names it, but value-moving actions stay behind the canary gate: a
   * kill switch, a hard per-action cap and a sender allowlist.
   */
  | "CANARY"
  /** Present in the model so the shape is real, but not selectable. */
  | "DESIGNED";

export type ArcTokenDefinition = {
  /** ERC-20 interface address. */
  address: `0x${string}`;
  /** Decimals of the ERC-20 interface. Arc's native view of USDC uses 18. */
  decimals: number;
  symbol: string;
};

export type ArcNetwork = {
  id: string;
  label: string;
  shortLabel: string;
  status: ArcNetworkStatus;
  /** The single source for every chain identifier below. */
  chainId: number;
  /** Circle App Kit's own name for the network. */
  appKitChain: string;
  explorerBaseUrl: string;
  rpc: {
    /** The network operator's own endpoint. */
    primary: string;
    /** Documented provider mirrors, in the operator's published order. */
    mirrors: readonly string[];
    /**
     * The published endpoint this product reads through by default and hands
     * a wallet first, when that is not the primary.
     *
     * Present only where the primary is known to refuse the people this
     * product serves. It must be one of the published endpoints above — it is
     * an ordering, never a new host.
     */
    preferred?: string;
    /**
     * The published endpoints this product reads through and hands a wallet,
     * in that order, on a network where some published endpoints refuse the
     * people this product serves.
     *
     * A selection of the published list, never a new host: a wallet handed a
     * host that refuses its owner cannot read its own balance, and a server
     * read that lands on one fails for nothing. Absent, every published
     * endpoint is served, the preferred one first.
     */
    served?: readonly string[];
  };
  nativeCurrency: { name: string; symbol: string; decimals: number };
  tokens: { usdc: ArcTokenDefinition; eurc?: ArcTokenDefinition };
  /** True only for a network where a mistake costs real money. */
  carriesRealValue: boolean;
  /** Why this network is not selectable, or what still bounds it when it is. */
  gate: string | null;
};

/** CAIP-2 chain reference. Derived, never typed. */
export function chainRefFor(network: ArcNetwork): string {
  return `eip155:${network.chainId}`;
}

/** The hex chain id a wallet expects. Derived, never typed. */
export function hexChainIdFor(network: ArcNetwork): `0x${string}` {
  return `0x${network.chainId.toString(16).toUpperCase()}` as `0x${string}`;
}

/** CAIP-19 asset reference for a token on this network. Derived, never typed. */
export function assetRefFor(network: ArcNetwork, token: ArcTokenDefinition): string {
  return `${chainRefFor(network)}/erc20:${token.address}`;
}

export function explorerTransactionUrl(network: ArcNetwork, transactionHash: string): string {
  return `${network.explorerBaseUrl}/tx/${transactionHash.toLowerCase()}`;
}

/** Every RPC endpoint the network operator publishes, primary first. */
export function publishedRpcEndpoints(network: ArcNetwork): readonly string[] {
  return [network.rpc.primary, ...network.rpc.mirrors];
}

/** The endpoint this product reads through when nothing is configured. */
export function defaultRpcEndpoint(network: ArcNetwork): string {
  return network.rpc.preferred ?? network.rpc.primary;
}

/**
 * The published endpoints in the order a wallet should try them.
 *
 * A wallet adds a network with the first URL as its default. On a network
 * whose primary refuses whole countries, handing the primary first gives a
 * person in one of those countries a wallet that cannot read its own balance,
 * so the preferred endpoint leads — and where the network names the endpoints
 * it serves, only those are handed over. On a network with neither this is
 * exactly {@link publishedRpcEndpoints}.
 */
export function walletRpcEndpoints(network: ArcNetwork): readonly string[] {
  if (network.rpc.served) return [...network.rpc.served];
  return [...new Set([defaultRpcEndpoint(network), ...publishedRpcEndpoints(network)])];
}

/** Whether a deployment may run against a network with this status. */
export function isSelectableArcNetworkStatus(status: ArcNetworkStatus): boolean {
  return status === "ACTIVE" || status === "CANARY";
}

export const ARC_TESTNET_NETWORK: ArcNetwork = {
  id: "arc-testnet",
  label: "Arc Testnet",
  shortLabel: "Testnet",
  status: "ACTIVE",
  chainId: 5_042_002,
  appKitChain: "Arc_Testnet",
  explorerBaseUrl: "https://testnet.arcscan.app",
  rpc: {
    primary: "https://rpc.testnet.arc.io",
    /* Arc publishes these alongside the primary. They are not a workaround:
       the primary refuses entire countries at its WAF, so a build that knows
       only the primary is unusable from a blocked region. */
    mirrors: [
      "https://rpc.blockdaemon.testnet.arc.io",
      "https://rpc.drpc.testnet.arc.io",
      "https://rpc.quicknode.testnet.arc.io",
    ],
  },
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  tokens: {
    usdc: { address: "0x3600000000000000000000000000000000000000", decimals: 6, symbol: "USDC" },
    eurc: { address: "0x89b50855aa3be2f677cd6303cec089b5f319d72a", decimals: 6, symbol: "EURC" },
  },
  carriesRealValue: false,
  gate: null,
};

/**
 * Arc Mainnet, from Arc's own documentation and the chain itself.
 *
 * Sources, read 2026-09-23: `docs.arc.io/arc/references/connect-to-arc` (chain
 * id 5042, the four public RPC hosts in this order, `explorer.arc.io`, USDC as
 * the 18-decimal native currency) and `docs.arc.io/arc/references/
 * contract-addresses` (USDC's 6-decimal ERC-20 interface at `0x3600…0000`, EURC
 * at `0xbEf5…C21c1`). The same day the chain answered `eth_chainId` = `0x13b2`
 * through the Blockdaemon and dRPC hosts, and `decimals()` = 6 for both token
 * contracts, which carry deployed code.
 *
 * `preferred` is dRPC because on that day `rpc.mainnet.arc.io` and the
 * QuickNode host both answered 403 from Ukraine while dRPC and Blockdaemon
 * answered. The primary stays first in the published list, because that list
 * is the operator's, not ours; `served` is ours — the two hosts that answer,
 * dRPC first, for the server's reads and for the wallet a person adds.
 *
 * `appKitChain` is App Kit's documented identifier for Arc Mainnet. The App
 * Kit installed with this build (1.11.0) does not define it, so the swap path
 * refuses mainnet before calling App Kit; see `app/api/arc-guard/route.ts`.
 */
export const ARC_MAINNET_NETWORK: ArcNetwork = {
  id: "arc-mainnet",
  label: "Arc Mainnet",
  shortLabel: "Mainnet",
  status: "CANARY",
  chainId: 5_042,
  appKitChain: "Arc",
  explorerBaseUrl: "https://explorer.arc.io",
  rpc: {
    primary: "https://rpc.mainnet.arc.io",
    mirrors: [
      "https://rpc.blockdaemon.mainnet.arc.io",
      "https://rpc.drpc.mainnet.arc.io",
      "https://rpc.quicknode.mainnet.arc.io",
    ],
    preferred: "https://rpc.drpc.mainnet.arc.io",
    served: ["https://rpc.drpc.mainnet.arc.io", "https://rpc.blockdaemon.mainnet.arc.io"],
  },
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  tokens: {
    usdc: { address: "0x3600000000000000000000000000000000000000", decimals: 6, symbol: "USDC" },
    eurc: { address: "0xbef5f6d51cb62b58e6a8f77868681825c6fe21c1", decimals: 6, symbol: "EURC" },
  },
  carriesRealValue: true,
  gate:
    "Arc Mainnet runs only on a deployment that selects it, and only as a canary (canon Gate D): sends stay closed until the operator opens the kill switch, each send is capped by code, only allowlisted wallets may send, and every send is reconciled against the chain before it gets a receipt. The App Kit swap is not offered on Arc Mainnet in this build. A network switch is not what makes mainnet safe.",
};

export const ARC_NETWORKS: readonly ArcNetwork[] = [ARC_TESTNET_NETWORK, ARC_MAINNET_NETWORK];

export function findArcNetwork(id: string): ArcNetwork | undefined {
  return ARC_NETWORKS.find((network) => network.id === id);
}

/**
 * Short names an operator may type for a network, mapped to its id.
 *
 * One table, used by every resolver, so the network a screen names and the
 * network a transaction is built for cannot be decided by two different
 * readings of the same variable.
 */
const ARC_NETWORK_ALIASES: Readonly<Record<string, string>> = {
  mainnet: ARC_MAINNET_NETWORK.id,
  testnet: ARC_TESTNET_NETWORK.id,
};

/** The registry id an `ARC_NETWORK` value names, or null when it names none. */
export function normalizeArcNetworkId(value: string | undefined | null): string | null {
  const requested = value?.trim().toLowerCase();
  if (!requested) return null;
  return ARC_NETWORK_ALIASES[requested] ?? requested;
}

/**
 * Select the network this process runs against.
 *
 * A `DESIGNED` network cannot be selected, and asking for it is an error naming
 * the gate rather than a silent fall back to testnet. Falling back would be
 * worse than failing: an operator who believed they had switched to mainnet
 * would keep transacting on a network with no real value and never know.
 *
 * Selecting a `CANARY` network is allowed and is not the permission to move
 * money on it; that lives in the canary gate.
 */
export function resolveArcNetwork(
  env: Record<string, string | undefined> = process.env,
  networks: readonly ArcNetwork[] = ARC_NETWORKS,
): ArcNetwork {
  const raw = env.ARC_NETWORK?.trim();
  const requested = normalizeArcNetworkId(raw);
  if (!requested) return ARC_TESTNET_NETWORK;
  const network = networks.find((entry) => entry.id === requested);
  if (!network) {
    throw new Error(
      `ARC_NETWORK "${raw}" is not a known Arc network. Known: ${networks.map((item) => item.id).join(", ")}.`,
    );
  }
  if (!isSelectableArcNetworkStatus(network.status)) {
    throw new Error(`ARC_NETWORK "${raw}" is not selectable. ${network.gate ?? ""}`.trim());
  }
  return network;
}

/**
 * Resolve the RPC endpoint for server-side reads.
 *
 * `ARC_RPC_URL` overrides on any network. `ARC_TESTNET_RPC_URL` keeps working
 * as the explicit override on a network that carries no value, and is ignored
 * on one that does: a variable copied from the testnet project must never
 * become where a mainnet money path reads its evidence. Without an override the
 * network's default endpoint is used. An override must be an absolute HTTPS
 * URL: a settlement path must never read chain state from an endpoint the
 * operator did not mean to use, so a malformed or downgraded value throws
 * instead of quietly falling back.
 */
export function resolveArcRpcUrl(
  network: ArcNetwork,
  env: Record<string, string | undefined> = process.env,
): string {
  const configured = configuredRpcOverride(network, env);
  if (!configured) return defaultRpcEndpoint(network);
  let parsed: URL;
  try {
    parsed = new URL(configured);
  } catch {
    throw new Error("The configured Arc RPC URL must be an absolute URL.");
  }
  if (parsed.protocol !== "https:") {
    throw new Error("The configured Arc RPC URL must use https.");
  }
  return configured;
}

function configuredRpcOverride(
  network: ArcNetwork,
  env: Record<string, string | undefined>,
): string | undefined {
  const testnetOverride = network.carriesRealValue ? undefined : env.ARC_TESTNET_RPC_URL?.trim();
  return testnetOverride || env.ARC_RPC_URL?.trim() || undefined;
}

/**
 * Every endpoint a server-side read may go through, in order.
 *
 * An operator's override stands alone: it was configured on purpose, and a
 * read that quietly moved past it would be a read from an endpoint nobody
 * chose. Without one, a network that names its served endpoints is read
 * through them — the next one only when the one before it does not answer —
 * and any other network through its single default, exactly as before.
 */
export function resolveArcRpcUrls(
  network: ArcNetwork,
  env: Record<string, string | undefined> = process.env,
): readonly string[] {
  const first = resolveArcRpcUrl(network, env);
  if (configuredRpcOverride(network, env)) return [first];
  return network.rpc.served ? [...network.rpc.served] : [first];
}
