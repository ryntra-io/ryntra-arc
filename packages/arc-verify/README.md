# @ryntra/arc-verify

Check a Ryntra settlement receipt yourself. Recompute its two seals, then read
the transaction it records back from Arc and hold every fact the receipt
states against the chain: status, token contract, amounts, the wallets a
payout names, block, network fee, total debit and time.

Read-only: nothing here holds a key, signs or sends. No runtime dependencies;
Node.js 22.18 or later runs the TypeScript sources directly.

## Command line

```bash
node packages/arc-verify/src/cli.ts <reference>
node packages/arc-verify/src/cli.ts --receipt receipt.json
```

| Option | Meaning |
|---|---|
| `<reference>` | The receipt id (`rcp_…`, `rcpt_…`), its operation id (`int_…`), either seal, or the transaction hash |
| `--receipt <file>` | The receipt JSON you hold; its seals are recomputed on your machine, and a payout's wallets are checked |
| `--verifier <url>` | The receipt verifier to ask; default `https://ryntra.io/api/arc-verify` |
| `--no-verifier` | Ask no verifier; needs `--receipt` |
| `--rpc <url>` | An Arc JSON-RPC endpoint to read through; repeat for more. Default: the endpoints Arc publishes for the receipt's network |
| `--json` | Print the whole report as JSON |

Exit status: `0` CONFIRMED, `1` CONTRADICTED, `2` INCOMPLETE, `64` usage.

## Library

```ts
import { verifyReceipt } from "@ryntra/arc-verify";

const report = await verifyReceipt({ reference: "rcp_62a901894bac4b9cbdd335445e101635" });
report.verdict; // "CONFIRMED" | "CONTRADICTED" | "INCOMPLETE"
report.checks;  // [{ id: "amount", status: "MATCH", detail: "1.000000 USDC moved, as recorded (1.000000)" }, …]
```

| Module | What it does |
|---|---|
| `src/canonical.ts` | The canonical JSON and both seals — re-exported from the modules the product seals with (`lib/guard/canonical-json.ts`, `lib/guard/canonical.ts`, `lib/guard/payout-canonical.ts`) |
| `src/receipt.ts` | A receipt as a document: its references, its chain, `checkSeal`, and `publicSummary` — the projection Ryntra's receipt verifier returns; the verifier route imports all four from here |
| `src/networks.ts` | Arc Testnet and Arc Mainnet, their published RPC endpoints and the USDC and EURC contracts, from `lib/guard/networks.ts` |
| `src/chain.ts` | One transaction read over JSON-RPC from the first endpoints that answer, two of them compared |
| `src/check.ts` | Every fact of a transfer, payout, exchange or swap receipt held against that reading |
| `src/verifier.ts` | The verifier's answer, parsed member by member |
| `src/verify.ts` | `verifyReceipt` — seal, verifier and chain together, and the verdict |
| `src/cli.ts` | The command line |
| `schema/receipt.schema.json` | The receipt as JSON Schema 2020-12, generated from the schema the product validates with |
| `schema/received-receipt.schema.json` | A payment received into a team's wallet, as JSON Schema 2020-12 |
| `schema/bridge-receipt.schema.json` | A transfer into or out of Arc through Circle's CCTP (receipt `1.7.0`): the burn on one network, Circle's attestation and the mint on the other, the amounts and the fee, as JSON Schema 2020-12 |
| `schema/route-receipt.schema.json` | A route into or out of Arc on Relay, Across or Circle's bridge with the integrator's fee (receipt `1.8.0`): both sides, the quote at signing, and the integrator's fee as its own line with the evidence it was collected, as JSON Schema 2020-12 |
| `schema/swap-receipt.schema.json` | A swap on Arc through KyberSwap or Relay (receipt `1.9.0`): what was paid and what arrived, the quote at signing and its floor, the provider's own fee, and Ryntra's fee as its own line — with the evidence it was collected in the same transaction, or the provider's record that it was credited off-chain — as JSON Schema 2020-12 |

## Verdicts

- **`CONFIRMED`** — both seals reproduce (on your machine with `--receipt`,
  otherwise as recomputed by the verifier) and Arc shows what the receipt
  records.
- **`CONTRADICTED`** — a seal is broken, the verifier holds a different
  receipt under the same reference than the file you hold, or Arc shows
  something else.
- **`INCOMPLETE`** — nothing contradicts the receipt, but something could not
  be checked: no endpoint answered, the verifier did not, or the receipt is of
  a kind this package does not read back from Arc.

An unknown is never promoted to a success.

A transfer into or out of Arc (`1.7.0`) is sealed under its own label, so it
can never be read as a transfer or a payout. This package recomputes its seals
and asks the verifier; it does not yet read its two networks back itself, so
its verdict stops at `INCOMPLETE` — the burn and the mint are linked from the
receipt for anyone to open.

## Tests

```bash
node --test packages/arc-verify/src/*.test.mjs
```

Network-free. The receipts are complete documents sealed with the product's
own functions, with synthetic addresses; the chain answers are what an Arc
endpoint returns, including the native-currency mirror event Arc emits beside
every USDC Transfer.
