# Changelog

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
