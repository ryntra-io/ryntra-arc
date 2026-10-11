/**
 * The record of Ryntra's own contracts on Arc, their fee splits and their
 * keys (schema and rules — `schema.ts`).
 *
 * Empty on purpose: until a release puts a contract on Arc mainnet with the
 * founder's signature, there is nothing of Ryntra's on chain to name, and a row
 * is never written ahead of its transaction. The fee addresses Ryntra already
 * uses on Arc live in the attribution registry (`../attribution/registry.ts`,
 * served at `arc.ryntra.io/api/arc-registry`); a contract or key row may never
 * reuse one of them.
 */
import { ARC_REGISTRY_SCHEMA, type ArcRegistry } from "./schema.ts";

export const ARC_REGISTRY: ArcRegistry = {
  schema: ARC_REGISTRY_SCHEMA,
  contracts: [],
  splits: [],
  keys: [],
};
