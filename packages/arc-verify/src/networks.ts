/**
 * Arc networks and the Circle token contracts on them.
 *
 * The registry itself is the one the Ryntra product runs on,
 * `lib/guard/networks.ts`, imported rather than copied: chain ids, published
 * RPC endpoints, explorers and the USDC and EURC contract addresses come from
 * there and nowhere else. What this module adds is the handful of lookups a
 * verifier needs — which network a receipt names, which endpoints to read it
 * through, and which Circle token an address is.
 */

import {
  ARC_NETWORKS,
  chainRefFor,
  explorerTransactionUrl,
  publishedRpcEndpoints,
  walletRpcEndpoints,
} from "../../../lib/guard/networks.ts";
import type { ArcNetwork, ArcTokenDefinition } from "../../../lib/guard/networks.ts";

export { ARC_MAINNET_NETWORK, ARC_NETWORKS, ARC_TESTNET_NETWORK, chainRefFor, explorerTransactionUrl } from "../../../lib/guard/networks.ts";
export type { ArcNetwork, ArcTokenDefinition } from "../../../lib/guard/networks.ts";

const CAIP2 = /^eip155:(\d{1,12})$/;
const ASSET_REF = /^eip155:(\d{1,12})\/erc20:(0x[0-9a-fA-F]{40})$/;

/** The Arc network a CAIP-2 reference (`eip155:5042002`) names, or null. */
export function arcNetworkForChainRef(chainRef: string | null | undefined): ArcNetwork | null {
  const match = chainRef ? CAIP2.exec(chainRef) : null;
  if (!match) return null;
  const chainId = Number(match[1]);
  return ARC_NETWORKS.find((network) => network.chainId === chainId) ?? null;
}

/**
 * Every published endpoint of a network, in the order a reader should try them.
 *
 * The endpoints the product itself reads through come first, then the rest of
 * what the network operator publishes. On a network whose primary host refuses
 * some countries at its firewall, a reader there still reaches the chain; a
 * reader elsewhere simply gets an answer from the first host.
 */
export function readEndpoints(network: ArcNetwork): readonly string[] {
  return [...new Set([...walletRpcEndpoints(network), ...publishedRpcEndpoints(network)])];
}

export type CircleToken = ArcTokenDefinition & { key: "usdc" | "eurc" };

/** The Circle tokens this network defines, USDC first. */
export function circleTokens(network: ArcNetwork): readonly CircleToken[] {
  const tokens: CircleToken[] = [{ key: "usdc", ...network.tokens.usdc }];
  if (network.tokens.eurc) tokens.push({ key: "eurc", ...network.tokens.eurc });
  return tokens;
}

/** The Circle token at this address on this network, or null. */
export function circleTokenAt(network: ArcNetwork, address: string | null | undefined): CircleToken | null {
  if (!address) return null;
  const wanted = address.toLowerCase();
  return circleTokens(network).find((token) => token.address.toLowerCase() === wanted) ?? null;
}

/** The token address a CAIP-19 asset reference names on this network, or null. */
export function assetAddressOn(network: ArcNetwork, assetRef: string | null | undefined): string | null {
  const match = assetRef ? ASSET_REF.exec(assetRef) : null;
  if (!match || `eip155:${match[1]}` !== chainRefFor(network)) return null;
  return match[2].toLowerCase();
}

/** Where a person can look at the same transaction without this tool. */
export function explorerLink(network: ArcNetwork, transactionHash: string): string {
  return explorerTransactionUrl(network, transactionHash);
}
