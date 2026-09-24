# Contributing

Thanks for looking. This repository is a bounded, read-only source
distribution, so the most useful contributions are usually corrections: a check
that accepts something the chain contradicts, a sentence that says more than
the check proves, a network fact that has changed.

## Before a pull request

```bash
npm ci
npm run verify
```

`verify` runs lint, typecheck, the network-free tests and the boundary gate.
All four must pass. The tests never reach a network: receipts are complete
documents sealed with the same functions the product seals with, and chain
behaviour is proven over the JSON-RPC answers an Arc endpoint gives, so a bad
afternoon at somebody's RPC provider cannot turn this repository red.

## What will not be merged

- Anything that builds, signs or submits a transaction, holds key material, or
  calls an RPC method outside the read allowlist. The boundary gate fails the
  build.
- A second copy of the canonical serialization or the seal functions. They are
  single-source on purpose: a verifier with its own copy of the encoding checks
  its copy, not the receipt.
- A verdict that turns an unknown into a success. An endpoint that cannot be
  read, a verifier that does not answer or a fact a receipt does not state is
  reported as exactly that.
- A wallet address in a test, a document or an example. Tests use synthetic
  addresses; the boundary gate refuses any other.

## Style

Match the surrounding code. Comments explain *why* something is the way it is,
particularly where the obvious implementation would be wrong — those comments
are load-bearing, and deleting one usually means the next person reintroduces
the defect it describes.
