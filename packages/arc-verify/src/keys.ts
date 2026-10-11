/**
 * Whose signature and whose anchor a verifier trusts: Ryntra's public registry
 * of its contracts and keys on Arc, with the days each was valid
 * (`lib/arc/registry/registry.ts`).
 *
 * The registry ships inside this package, as of its release, and the open
 * repository keeps every earlier version: a key Ryntra rotated stays trusted
 * for the days it was valid, a revoked one is trusted for nothing it signed
 * from the moment of revocation. A newer registry (a key added after this
 * release) can be handed in instead — `--registry <file>` — in the same
 * shape as the record (`ryntra.arc-registry/1`).
 *
 * The answer is one of three, never a guess:
 *
 * - `TRUSTED` — the address is the registry's key (or contract) of that role
 *   and network on that day, not revoked by then;
 * - `NOT_TRUSTED` — the registry names a different key for that role and
 *   network on that day, or this one was revoked by then: the signature is not
 *   Ryntra's;
 * - `UNKNOWN` — the registry names no key of that role and network on that
 *   day: an older verifier may simply not know a newer key.
 */

import { ARC_REGISTRY } from "../../../lib/arc/registry/registry.ts";
import { ARC_REGISTRY_CHAIN_IDS, ARC_REGISTRY_SCHEMA, validateArcRegistry } from "../../../lib/arc/registry/schema.ts";
import type { ArcRegistry, ArcRegistryNetwork, KeyRole, RyntraArcContract } from "../../../lib/arc/registry/schema.ts";

export { ARC_REGISTRY } from "../../../lib/arc/registry/registry.ts";
export type { ArcRegistry, KeyRole } from "../../../lib/arc/registry/schema.ts";

export type Trust = Readonly<{ state: "TRUSTED" | "NOT_TRUSTED" | "UNKNOWN"; detail: string; id: string | null }>;

const DAY_MS = 86_400_000;
const dayOf = (at: number) => new Date(at).toISOString().slice(0, 10);
const validOn = (row: { validFrom: string; validTo: string | null }, day: string) => row.validFrom <= day && (row.validTo === null || day <= row.validTo);

/** The registry network of a chain id, or null. */
export function registryNetworkOf(chainId: number): ArcRegistryNetwork | null {
  const entry = Object.entries(ARC_REGISTRY_CHAIN_IDS).find(([, id]) => id === chainId);
  return entry ? (entry[0] as ArcRegistryNetwork) : null;
}

/** Whether `address` is the registry's `role` key on `chainId` at moment `at` (ms). */
export function keyTrust(registry: ArcRegistry, role: KeyRole, chainId: number, address: string, at: number): Trust {
  const network = registryNetworkOf(chainId);
  if (!network) return { state: "UNKNOWN", detail: `chain ${chainId} is not an Arc network of the registry`, id: null };
  if (!Number.isFinite(at)) return { state: "UNKNOWN", detail: "no moment to check the key at", id: null };
  const day = dayOf(at);
  const wanted = address.toLowerCase();
  const rows = registry.keys.filter((k) => k.role === role && k.network === network && validOn(k, day));
  const own = rows.find((k) => k.address === wanted);
  if (own) {
    if (own.revokedAt !== null && Date.parse(own.revokedAt) <= at) {
      return { state: "NOT_TRUSTED", detail: `the ${role} key ${own.id} was revoked at ${own.revokedAt}`, id: own.id };
    }
    return { state: "TRUSTED", detail: `the registry's ${role} key ${own.id} on ${network}, valid on ${day}`, id: own.id };
  }
  if (rows.length > 0) return { state: "NOT_TRUSTED", detail: `on ${day} the registry's ${role} key on ${network} is ${rows.map((k) => k.id).join(", ")}, not this one`, id: null };
  return { state: "UNKNOWN", detail: `the registry this verifier holds names no ${role} key on ${network} for ${day}`, id: null };
}

/** Whether `address` is the registry's `contract` on `chainId` on the day of `at`. */
export function contractTrust(registry: ArcRegistry, contract: RyntraArcContract, chainId: number, address: string, at: number): Trust {
  const network = registryNetworkOf(chainId);
  if (!network) return { state: "UNKNOWN", detail: `chain ${chainId} is not an Arc network of the registry`, id: null };
  const day = dayOf(Number.isFinite(at) ? at : Date.now());
  const rows = registry.contracts.filter((c) => c.contract === contract && c.network === network && validOn(c, day));
  const own = rows.find((c) => c.address === address.toLowerCase());
  if (own) return { state: "TRUSTED", detail: `the registry's ${contract} ${own.id} on ${network}`, id: own.id };
  if (rows.length > 0) return { state: "NOT_TRUSTED", detail: `on ${day} the registry's ${contract} on ${network} is ${rows.map((c) => c.address).join(", ")}`, id: null };
  return { state: "UNKNOWN", detail: `the registry this verifier holds names no ${contract} on ${network} for ${day}`, id: null };
}

/**
 * A registry handed in as JSON (`--registry`): accepted only in the record's own shape and only if it keeps the
 * registry's rules (`validateArcRegistry`) — a file that breaks them is refused, not half-read.
 */
export function parseRegistry(value: unknown): ArcRegistry | string {
  const record = value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  /* The public endpoint serves the record under `ryntra`; a file of the record itself is the record. */
  const candidate = record && record.schema !== ARC_REGISTRY_SCHEMA && record.ryntra && typeof record.ryntra === "object" ? (record.ryntra as Record<string, unknown>) : record;
  if (!candidate || candidate.schema !== ARC_REGISTRY_SCHEMA) return `not a ${ARC_REGISTRY_SCHEMA} record`;
  if (!Array.isArray(candidate.contracts) || !Array.isArray(candidate.splits) || !Array.isArray(candidate.keys)) return "the record needs contracts, splits and keys";
  const registry = candidate as unknown as ArcRegistry;
  let problems;
  try {
    problems = validateArcRegistry(registry);
  } catch {
    return "the record is malformed";
  }
  if (problems.length > 0) return `the record breaks the registry's rules: ${problems.slice(0, 3).map((p) => `${p.id} — ${p.problem}`).join("; ")}`;
  return registry;
}

/** The registry this package was released with. */
export const BUNDLED_REGISTRY: ArcRegistry = ARC_REGISTRY;

/** A moment from an ISO string, or NaN. */
export const momentOf = (iso: unknown): number => (typeof iso === "string" ? Date.parse(iso) : Number.NaN);

/** Days between two moments, for a person reading why. */
export const daysBetween = (a: number, b: number): number => Math.round(Math.abs(b - a) / DAY_MS);
