/**
 * The public registry of Ryntra's own contracts on Arc, the fee splits they
 * enforce and the keys that act for them — the schema and its rules: the
 * contracts, the attribution rules and the keys Ryntra publishes for Arc.
 *
 * Pure and client-safe: no clock, no network, no `process.env`. The record
 * itself lives in `registry.ts`; this file says what a valid record is, and
 * `validateArcRegistry` refuses anything else. A deployment script prints the
 * row it made (`contracts/arc/script/base/RyntraDeploy.sol`), the release
 * copies it here once the transaction is final, and the test of this module
 * keeps every row honest against Ryntra's published rules:
 *
 * - **Dated.** Every row says from which day it is valid and, once it stops,
 *   until which day; a reader of any past transaction can tell which address,
 *   split or key was Ryntra's on that day.
 * - **One address, one job.** An address is never two
 *   things at once — not two contracts, not a contract and a key, and never
 *   one of the fee addresses of the attribution registry.
 * - **Each contract's mutability.** RyntraLocker, the hook's split logic,
 *   ReceiptAnchor, the vault factory and the fee claimer are immutable; the factory, the router, the vaults and
 *   PolicyGuard (with its board of guardians) change only through a 48-hour timelock with a public record —
 *   a change effective sooner than 48 hours after its announcement is refused.
 * - **A split is whole.** A launch pool's fee is 1 %, of which Ryntra takes
 *   exactly 20 % and the creator divides the rest within the published bounds:
 *   to themself 40–70 %, liquidity at least 10 %, the rewards fund
 *   0–30 %. A change in the creator's own favour waits 48 hours; a cut does not.
 */

export const ARC_REGISTRY_SCHEMA = "ryntra.arc-registry/1" as const;

export type ArcRegistryNetwork = "arc-mainnet" | "arc-testnet";
export const ARC_REGISTRY_CHAIN_IDS: Readonly<Record<ArcRegistryNetwork, number>> = {
  "arc-mainnet": 5042,
  "arc-testnet": 5_042_002,
};

export const TIMELOCK_HOURS = 48;

/** The hook permissions of RyntraLaunchHook, as the low 14 bits of its address. */
export const LAUNCH_HOOK_FLAGS = 0x28cc;
export const HOOK_FLAG_MASK = 0x3fff;

/** Ryntra's own contracts on Arc and how each may change. */
export const RYNTRA_ARC_CONTRACTS = {
  RyntraLaunchHook: "immutable",
  RyntraLocker: "immutable",
  ReceiptAnchor: "immutable",
  RyntraLaunchFactory: "timelock",
  RyntraRouter: "timelock",
  AutopilotVault: "timelock",
  CampaignVault: "timelock",
  PolicyGuard: "timelock",
  /* The three that serve them: PolicyGuard's board of guardians (its admin acts through a 48-hour timelock), the
     factory that clones AutopilotVault and the claimer of a launch pool's fee shares — neither of the last two has
     an admin. */
  GuardianBoard: "timelock",
  AutopilotVaultFactory: "immutable",
  RyntraFeeClaimer: "immutable",
} as const;

export type RyntraArcContract = keyof typeof RYNTRA_ARC_CONTRACTS;
export type Mutability = (typeof RYNTRA_ARC_CONTRACTS)[RyntraArcContract];

export type Address = `0x${string}`;
/** A calendar day, UTC: `YYYY-MM-DD`. */
export type Day = string;
/** A moment, UTC: `YYYY-MM-DDTHH:MM:SSZ`. */
export type Moment = string;

export type ContractChange = Readonly<{
  /** When the change was announced on chain (the timelock's event). */
  announcedAt: Moment;
  /** When it took effect; at least 48 hours after the announcement. */
  effectiveAt: Moment;
  what: string;
  tx: string | null;
}>;

export type ContractRow = Readonly<{
  kind: "contract";
  id: string;
  contract: RyntraArcContract;
  network: ArcRegistryNetwork;
  address: Address;
  validFrom: Day;
  /** Null while the contract is Ryntra's current one; an immutable contract is never closed. */
  validTo: Day | null;
  mutability: Mutability;
  /** The deployment transaction; required before a mainnet row is published. */
  deployTx: string | null;
  source: Readonly<{ commit: string; path: string }>;
  /** Null until an outside audit is published; the page then says «contracts not yet audited». */
  audit: Readonly<{ by: string; report: string; on: Day }> | null;
  changes: readonly ContractChange[];
}>;

export const SPLIT_ROLES = ["creator", "rewards", "liquidity", "ryntra"] as const;
export type SplitRole = (typeof SPLIT_ROLES)[number];

export type SplitShare = Readonly<{
  role: SplitRole;
  /** Basis points of the fee (not of the trade). */
  bps: number;
  /** Ryntra's share goes to one fixed address; the others are each pool's own («per-pool»). */
  recipient: Address | "per-pool";
}>;

export type SplitRow = Readonly<{
  kind: "split";
  id: string;
  /** What the split applies to: the default of every launch pool, or one pool by its id. */
  scope: "launch-default" | `pool:0x${string}`;
  network: ArcRegistryNetwork;
  /** The pool fee in basis points of the trade: 100 = 1 %. */
  feeBps: number;
  shares: readonly SplitShare[];
  validFrom: Day;
  validTo: Day | null;
  /** When a change of a split was announced; null for the first split of a scope or a cut of the creator's share. */
  announcedAt: Moment | null;
  /** For a pool's own split: the day the pool was created. Null for the launch default. A pool's split valid from
   *  that day is the creator's choice at launch; one valid later is a change from the launch default. */
  poolCreatedOn: Day | null;
}>;

export const KEY_ROLES = ["executor", "receipt-signer", "attestor"] as const;
export type KeyRole = (typeof KEY_ROLES)[number];

export type KeyRow = Readonly<{
  kind: "key";
  id: string;
  role: KeyRole;
  environment: "stand" | "mainnet";
  network: ArcRegistryNetwork;
  address: Address;
  validFrom: Day;
  validTo: Day | null;
  /** A compromised key: the moment from which nothing it signs is trusted, even inside its last day. */
  revokedAt: Moment | null;
}>;

export type ArcRegistry = Readonly<{
  schema: typeof ARC_REGISTRY_SCHEMA;
  contracts: readonly ContractRow[];
  splits: readonly SplitRow[];
  keys: readonly KeyRow[];
}>;

export const LAUNCH_FEE_BPS = 100;
export const WHOLE_BPS = 10_000;
/** Ryntra's share of a launch pool's fee — fixed in the hook, never a parameter. */
export const RYNTRA_SHARE_BPS = 2_000;
/** The creator's bounds inside the other 80 %, in basis points of the fee. */
export const CREATOR_BOUNDS: Readonly<Record<Exclude<SplitRole, "ryntra">, readonly [number, number]>> = {
  creator: [4_000, 7_000],
  liquidity: [1_000, 8_000],
  rewards: [0, 3_000],
};

const ID = /^[a-z0-9][a-z0-9-]*$/;
const ADDRESS = /^0x[0-9a-f]{40}$/;
const TX = /^0x[0-9a-f]{64}$/;
const COMMIT = /^[0-9a-f]{40}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const MOMENT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
const HOUR_MS = 3_600_000;

/* Date.parse first: `new Date("2026-13-01").toISOString()` throws, and the validator reports, it never throws. */
const isDay = (value: unknown): value is Day =>
  typeof value === "string" &&
  DAY.test(value) &&
  !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) &&
  new Date(`${value}T00:00:00Z`).toISOString().startsWith(value);
const isMoment = (value: unknown): value is Moment =>
  typeof value === "string" &&
  MOMENT.test(value) &&
  !Number.isNaN(Date.parse(value)) &&
  new Date(value).toISOString().replace(".000Z", "Z") === value;
const dayStart = (day: Day) => Date.parse(`${day}T00:00:00Z`);
/** The last moment a row is valid: the end of its `validTo` day, or forever. */
const dayEnd = (day: Day | null) => (day === null ? Number.POSITIVE_INFINITY : dayStart(day) + 24 * HOUR_MS - 1);
const overlaps = (a: { validFrom: Day; validTo: Day | null }, b: { validFrom: Day; validTo: Day | null }) =>
  dayStart(a.validFrom) <= dayEnd(b.validTo) && dayStart(b.validFrom) <= dayEnd(a.validTo);

export type RegistryProblem = Readonly<{ id: string; problem: string }>;

/**
 * Every way the record breaks the rules, or none. `feeAddresses` are the
 * attribution registry's published fee addresses: none of them may be a
 * contract or a key here.
 */
export function validateArcRegistry(registry: ArcRegistry, feeAddresses: readonly string[] = []): RegistryProblem[] {
  const problems: RegistryProblem[] = [];
  const say = (id: string, problem: string) => problems.push({ id, problem });

  if (registry.schema !== ARC_REGISTRY_SCHEMA) say("registry", `schema must be ${ARC_REGISTRY_SCHEMA}`);

  const rows = [...registry.contracts, ...registry.splits, ...registry.keys];
  const seen = new Set<string>();
  for (const row of rows) {
    if (!ID.test(row.id)) say(row.id, "id must be lowercase kebab-case");
    if (seen.has(row.id)) say(row.id, "id listed twice");
    seen.add(row.id);
    if (!(row.network in ARC_REGISTRY_CHAIN_IDS)) say(row.id, "unknown network");
    if (!isDay(row.validFrom)) say(row.id, "validFrom must be a real day, YYYY-MM-DD");
    if (row.validTo !== null && !isDay(row.validTo)) say(row.id, "validTo must be a real day or null");
    if (isDay(row.validFrom) && row.validTo !== null && isDay(row.validTo) && row.validTo < row.validFrom) {
      say(row.id, "validTo is before validFrom");
    }
  }

  // One address, one job — across contracts and keys, and never a fee address.
  const fees = new Set(feeAddresses.map((a) => a.toLowerCase()));
  const holders = [...registry.contracts, ...registry.keys];
  for (const row of holders) {
    if (!ADDRESS.test(row.address)) say(row.id, "address must be lowercase 0x + 40 hex");
    if (/^0x0{40}$/.test(row.address)) say(row.id, "address is zero");
    if (fees.has(row.address)) say(row.id, "address is a fee address of the attribution registry");
  }
  // Ryntra's share of a split goes to an address that is only that: not zero, not a contract or key here, not a fee
  // address of the attribution registry (one address, one job).
  for (const row of registry.splits) {
    const ryntra = row.shares.find((s) => s.role === "ryntra")?.recipient;
    if (typeof ryntra !== "string" || !ADDRESS.test(ryntra)) continue;
    if (/^0x0{40}$/.test(ryntra)) say(row.id, "Ryntra's share goes to the zero address");
    if (fees.has(ryntra)) say(row.id, "Ryntra's share goes to a fee address of the attribution registry");
    const holder = holders.find((h) => h.address === ryntra && h.network === row.network && overlaps(h, row));
    if (holder) say(row.id, `Ryntra's share goes to an address that already does another job (${holder.id})`);
  }
  for (let i = 0; i < holders.length; i += 1) {
    for (let j = i + 1; j < holders.length; j += 1) {
      const a = holders[i];
      const b = holders[j];
      if (a.address === b.address && a.network === b.network && overlaps(a, b)) {
        say(b.id, `address already does another job (${a.id})`);
      }
    }
  }

  for (const row of registry.contracts) validateContract(row, say);
  for (const row of registry.keys) validateKey(row, say);
  for (const row of registry.splits) validateSplit(row, say);

  // A role of an environment has one key at a time: rotation closes the old row on the day before the new one
  // starts (days count whole); a compromised key also carries `revokedAt`, which cuts its last day short — and
  // until the next day begins, that role has no valid key at all, which is the safe side.
  for (let i = 0; i < registry.keys.length; i += 1) {
    for (let j = i + 1; j < registry.keys.length; j += 1) {
      const a = registry.keys[i];
      const b = registry.keys[j];
      if (a.role === b.role && a.environment === b.environment && a.network === b.network && overlaps(a, b)) {
        say(b.id, `two ${a.role} keys of ${a.environment} at once (${a.id})`);
      }
    }
  }

  // One split per scope at a time; a later split that raises the creator's share waited 48 hours. A pool's first
  // own split that starts after the pool's first day is a change from the launch default the pool lived under
  // until then, and is held to the same rule; one that starts on the pool's first day is the creator's launch choice.
  const byScope = new Map<string, SplitRow[]>();
  for (const row of registry.splits) {
    const key = `${row.network}|${row.scope}`;
    byScope.set(key, [...(byScope.get(key) ?? []), row]);
  }
  for (const group of byScope.values()) {
    const ordered = [...group].sort((a, b) => a.validFrom.localeCompare(b.validFrom));
    const first = ordered[0];
    const inherited =
      first.scope === "launch-default" || first.poolCreatedOn === first.validFrom
        ? undefined
        : registry.splits.find(
            (row) =>
              row.scope === "launch-default" &&
              row.network === first.network &&
              isDay(row.validFrom) &&
              isDay(first.validFrom) &&
              dayStart(row.validFrom) < dayStart(first.validFrom) &&
              dayStart(first.validFrom) - 1 <= dayEnd(row.validTo),
          );
    if (first.scope !== "launch-default" && first.poolCreatedOn !== first.validFrom && !inherited) {
      say(first.id, "changes a pool's split, but no launch default it lived under is in the record to compare with");
    }
    const steps: Array<readonly [SplitRow, SplitRow]> = inherited ? [[inherited, first]] : [];
    for (let i = 1; i < ordered.length; i += 1) steps.push([ordered[i - 1], ordered[i]]);
    for (const [before, after] of steps) {
      if (before.scope === after.scope && overlaps(before, after)) say(after.id, `overlaps ${before.id} of the same scope`);
      if (!isDay(after.validFrom)) continue;
      const raised = share(after, "creator") > share(before, "creator");
      if (!raised) continue;
      if (after.announcedAt === null || !isMoment(after.announcedAt)) {
        say(after.id, "raises the creator's share without an announcement");
      } else if (dayStart(after.validFrom) - Date.parse(after.announcedAt) < TIMELOCK_HOURS * HOUR_MS) {
        say(after.id, `raises the creator's share sooner than ${TIMELOCK_HOURS} h after its announcement`);
      }
    }
  }

  return problems;
}

function validateContract(row: ContractRow, say: (id: string, problem: string) => void) {
  const rule = RYNTRA_ARC_CONTRACTS[row.contract];
  if (rule === undefined) {
    say(row.id, "not one of Ryntra's contracts on Arc");
    return;
  }
  if (row.mutability !== rule) say(row.id, `${row.contract} is ${rule} by Ryntra's rules`);
  if (rule === "immutable" && row.validTo !== null) say(row.id, "an immutable contract never stops being what it is");
  if (rule === "immutable" && row.changes.length > 0) say(row.id, "an immutable contract has no changes");
  if (row.deployTx !== null && !TX.test(row.deployTx)) say(row.id, "deployTx must be 0x + 64 lowercase hex");
  if (row.network === "arc-mainnet" && row.deployTx === null) say(row.id, "a mainnet row is published with its deployment transaction");
  if (!COMMIT.test(row.source.commit)) say(row.id, "source.commit must be a full commit SHA");
  if (!/^contracts\/arc\/src\/.+\.sol$/.test(row.source.path)) say(row.id, "source.path must be a file under contracts/arc/src/");
  if (row.audit !== null) {
    if (!row.audit.by.trim()) say(row.id, "audit.by is empty");
    if (!/^https:\/\//.test(row.audit.report)) say(row.id, "audit.report must be an https link");
    if (!isDay(row.audit.on)) say(row.id, "audit.on must be a real day");
  }
  if (row.contract === "RyntraLaunchHook" && ADDRESS.test(row.address)) {
    const flags = Number(BigInt(row.address) & BigInt(HOOK_FLAG_MASK));
    if (flags !== LAUNCH_HOOK_FLAGS) {
      say(row.id, `hook permissions 0x${flags.toString(16)} ≠ 0x${LAUNCH_HOOK_FLAGS.toString(16)}`);
    }
  }
  let last = Number.NEGATIVE_INFINITY;
  for (const change of row.changes) {
    if (!isMoment(change.announcedAt) || !isMoment(change.effectiveAt)) {
      say(row.id, "a change needs announcedAt and effectiveAt as YYYY-MM-DDTHH:MM:SSZ");
      continue;
    }
    const gap = Date.parse(change.effectiveAt) - Date.parse(change.announcedAt);
    if (gap < TIMELOCK_HOURS * HOUR_MS) say(row.id, `a change took effect sooner than ${TIMELOCK_HOURS} h after its announcement`);
    if (Date.parse(change.effectiveAt) < dayStart(row.validFrom)) say(row.id, "a change before the contract was valid");
    if (Date.parse(change.announcedAt) < last) say(row.id, "changes must be listed in order");
    last = Date.parse(change.announcedAt);
    if (change.tx !== null && !TX.test(change.tx)) say(row.id, "a change's tx must be 0x + 64 lowercase hex");
    if (!change.what.trim()) say(row.id, "a change says what changed");
  }
}

function validateKey(row: KeyRow, say: (id: string, problem: string) => void) {
  if (!(KEY_ROLES as readonly string[]).includes(row.role)) say(row.id, "unknown key role");
  if (row.revokedAt !== null) {
    if (!isMoment(row.revokedAt)) say(row.id, "revokedAt must be YYYY-MM-DDTHH:MM:SSZ or null");
    else if (isDay(row.validFrom) && Date.parse(row.revokedAt) < dayStart(row.validFrom)) say(row.id, "revoked before it was valid");
    else if (row.validTo !== null && isDay(row.validTo) && Date.parse(row.revokedAt) > dayEnd(row.validTo)) {
      say(row.id, "revoked after its last day");
    }
  }
  if (row.environment !== "stand" && row.environment !== "mainnet") say(row.id, "environment must be stand or mainnet");
  if (row.environment === "mainnet" && row.network !== "arc-mainnet") say(row.id, "a mainnet key acts on arc-mainnet");
}

const share = (row: SplitRow, role: SplitRole) => row.shares.find((s) => s.role === role)?.bps ?? 0;

function validateSplit(row: SplitRow, say: (id: string, problem: string) => void) {
  if (row.scope !== "launch-default" && !/^pool:0x[0-9a-f]{64}$/.test(row.scope)) {
    say(row.id, "scope must be launch-default or pool:<pool id>");
  }
  if (row.scope === "launch-default" && row.poolCreatedOn !== null) say(row.id, "the launch default has no pool day");
  if (row.scope !== "launch-default") {
    if (!isDay(row.poolCreatedOn)) say(row.id, "a pool's split names the day the pool was created");
    else if (isDay(row.validFrom) && row.validFrom < row.poolCreatedOn) say(row.id, "valid before the pool existed");
  }
  if (row.feeBps !== LAUNCH_FEE_BPS) say(row.id, `a launch pool's fee is ${LAUNCH_FEE_BPS} bps`);
  const roles = row.shares.map((s) => s.role);
  if (roles.length !== SPLIT_ROLES.length || SPLIT_ROLES.some((r) => !roles.includes(r))) {
    say(row.id, `a split names each of ${SPLIT_ROLES.join(", ")} once`);
  }
  let sum = 0;
  for (const s of row.shares) {
    if (!Number.isInteger(s.bps) || s.bps < 0) say(row.id, `${s.role}: bps must be a whole number ≥ 0`);
    sum += s.bps;
    if (s.role === "ryntra") {
      if (s.bps !== RYNTRA_SHARE_BPS) say(row.id, `Ryntra's share is ${RYNTRA_SHARE_BPS} bps of the fee, fixed`);
      if (s.recipient === "per-pool" || !ADDRESS.test(s.recipient)) say(row.id, "Ryntra's share goes to one lowercase address");
      continue;
    }
    const [low, high] = CREATOR_BOUNDS[s.role];
    if (s.bps < low || s.bps > high) say(row.id, `${s.role}: ${s.bps} bps is outside ${low}–${high}`);
    if (s.recipient !== "per-pool" && !ADDRESS.test(s.recipient)) say(row.id, `${s.role}: recipient must be per-pool or a lowercase address`);
  }
  if (sum !== WHOLE_BPS) say(row.id, `the shares add up to ${sum} bps, not ${WHOLE_BPS}`);
  if (row.announcedAt !== null && !isMoment(row.announcedAt)) say(row.id, "announcedAt must be YYYY-MM-DDTHH:MM:SSZ or null");
}
