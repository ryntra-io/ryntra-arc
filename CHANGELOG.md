# Changelog

## [0.3.1] — 2026-09-29

- The hash domains of every receipt version — the received-payment receipt
  (1.6.0) and the bridge receipt (1.7.0) among them — and the function that
  picks a receipt's domain by its schema version now live beside the canonical
  serializer in `lib/guard/canonical.ts`. `lib/guard/payout-canonical.ts`
  re-exports them unchanged: no receipt hashes differently, and nothing a
  receipt verifies changes.
- The package's version names this release; 0.2.0 and 0.3.0 were tagged
  while it still said 0.1.0.

## [0.3.0] — 2026-09-27

- Receipt 1.7.0: a transfer between Arc and another network through Circle's
  CCTP — the burn on one network, Circle's attested message and the mint on
  the other, the amount sent, the amount received and the fee, each read from
  its own chain and sealed under its own hash domain, so it can never be read
  as a transfer or a payout. It ships as `schema/bridge-receipt.schema.json`.
- `checkSeal` recomputes both seals, and `publicSummary` gives the verifier's
  projection with both transactions and without a wallet address.
- The command line recomputes the seals and asks the verifier; it does not
  read the two networks back itself yet, so a bridge receipt stops at
  `INCOMPLETE` with the reason stated.
- Network-free tests cover the seals, the references and the summary.

## [0.2.0] — 2026-09-27

- The received-payment receipt (schema 1.6.0): a payment a team received
  through its payment request, resting on the payer's own receipt. It ships
  as `schema/received-receipt.schema.json`, and the command line checks it
  against Arc like a transfer — the asset, the amount and the transaction,
  with both wallets read from the file only.
- The network registry's Arc Mainnet entry describes the operator's switch as
  the whole gate for a new send: no list of wallets and no ceiling beyond the
  wallet's own balance.

## [0.1.0] — 2026-09-24

- `@ryntra/arc-verify` 0.1.0, the first release: check a Ryntra settlement
  receipt yourself.
  - The receipt schema as JSON Schema 2020-12, generated from the schema the
    product validates with.
  - The canonical serialization and both seals — the receipt hash under its
    schema version's domain and the integrity hash over it — from the modules
    the product seals with.
  - The receipt as a document: its references, its chain, both seals
    recomputed, the public summary a stranger may see. Ryntra's receipt
    verifier route imports them from this module.
  - One transaction read from Arc's published JSON-RPC endpoints, compared
    across two of them, and every fact of a transfer, payout or USDC/EURC
    exchange receipt held against it: status, token contract, amounts, the
    wallets a payout names, block, network fee, total debit, time.
  - The `arc-verify` command line: `CONFIRMED`, `CONTRADICTED` or
    `INCOMPLETE`, with exit status 0, 1 or 2.
  - Network-free tests over complete receipts sealed with the product's own
    functions.
