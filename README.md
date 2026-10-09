# Ryntra Arc — receipt verification

[![verify](https://github.com/ryntra-io/ryntra-arc/actions/workflows/ci.yml/badge.svg)](https://github.com/ryntra-io/ryntra-arc/actions/workflows/ci.yml)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)

Ryntra on [Arc](https://arc.io) is dollar money on Circle's chain, from your
own wallet: send and receive USDC, swap tokens, trade spot, bridge USDC in from
other chains and pay out a team. Each transfer, payout, exchange and crosschain
move is signed in the person's own wallet, reconciled against the chain and
closed with a **settlement receipt**. This repository is how anyone checks such
a receipt without taking Ryntra's word for it.

`@ryntra/arc-verify` answers three questions about a receipt:

| Question | How it is answered |
|---|---|
| Is the receipt intact? | Both SHA-256 seals are recomputed over the receipt's canonical JSON — on your machine when you hold the file, or as recomputed by Ryntra's public verifier when you hold only a reference |
| Is it the receipt Ryntra holds? | With the file and the verifier's answer together, the file's seal must be the recorded one and the verifier's public summary must be exactly the one derived from the file |
| Does Arc show what it records? | The transaction is read from Arc's own published JSON-RPC endpoints, and every fact the receipt states — status, token contract, amounts, the wallets a payout names, block, network fee, total debit, time — is held against it |

It reads and never writes: no keys, no signing, no transactions.

Part of [Ryntra](https://ryntra.io). This repository contains the receipt
verification tooling and the product modules it stands on, not the
application.

## Use the product

[Open Ryntra on Arc](https://arc.ryntra.io/app) to send and receive USDC with a
payment link, swap tokens, trade spot with a live chart, bridge funds, pay out
a team and read the receipts for your activity. Wallet balances, percentage
amounts and gas-aware Max are available in Swap and Bridge.
See the [build log](BUILDLOG.md) for the latest shipped behavior and fees.

## Check a receipt

Node.js 22.18 or later.

```bash
git clone https://github.com/ryntra-io/ryntra-arc.git
cd ryntra-arc
npm ci
node packages/arc-verify/src/cli.ts rcp_62a901894bac4b9cbdd335445e101635
```

That reference is a treasury payout of 1 USDC on Arc Testnet. The output:

```text
Ryntra receipt check

  reference   rcp_62a901894bac4b9cbdd335445e101635
  receipt     PAYOUT · schema 1.2.0
  network     Arc Testnet · eip155:5042002
  transaction 0x6a0b5c17c71ca19c7dd64b5ff71435c905c28383f752d854527a239b8831c660
  explorer    https://testnet.arcscan.app/tx/0x6a0b5c17c71ca19c7dd64b5ff71435c905c28383f752d854527a239b8831c660

Seal
  intact — both hashes recomputed by the verifier match the recorded ones
  (pass --receipt <file> to recompute them on this machine)
  verifier https://ryntra.io/api/arc-verify: verified

Arc
  read through https://rpc.drpc.testnet.arc.io
  skipped https://rpc.testnet.arc.io — HTTP 403
  skipped https://rpc.blockdaemon.testnet.arc.io — has no receipt for this transaction
  skipped https://rpc.quicknode.testnet.arc.io — HTTP 403
  block 58673799 · 2026-08-24T19:52:13.000Z · 5144960 confirmations

Checks
  match         chain          the transaction is on Arc Testnet (chain id 5042002), the chain the receipt names
  match         status         the transaction succeeded
  match         contract       the transaction called the USDC contract 0x3600…0000 directly
  match         value          no native value was attached
  match         transfers      exactly one USDC Transfer event, from the USDC contract 0x3600…0000
  match         amount         1.000000 USDC moved, as recorded (1.000000)
  match         sender         the USDC left the wallet that signed the transaction
  not recorded  treasury       the public summary does not name the treasury wallet; the receipt file does
  not recorded  recipient      the public summary does not name the recipient; the receipt file does
  match         block          in block 58673799, as recorded
  match         debit          1.001234 USDC left the treasury with the fee, as recorded, within the approved ceiling of 1.010000
  match         usdc-decimals  USDC reports 6 decimals, the unit the receipt counts in
  match         fee            the network fee was 0.00123354 USDC (48950 gas at 25.2 gwei); recorded as 0.001234, rounded up to 6 decimals
  match         time           settled at 2026-08-24T19:52:13.000Z, before the receipt was sealed at 2026-08-24T19:52:15.458Z

CONFIRMED — The receipt is intact (recomputed by the verifier) and Arc shows the payout it records.
```

Which endpoints answer depends on where you run it from: the first host of a
network may refuse some regions, and a node without deep history may not have
an older transaction. Each skipped endpoint is named, and the next is tried.

A reference is any of: the receipt id, its operation id (`int_…`), either
seal, or the transaction hash. The public summary a verifier returns never
names a wallet, so a payout's treasury and recipient are `not recorded` there;
with the receipt file itself they are checked too:

```bash
node packages/arc-verify/src/cli.ts --receipt receipt.json
```

| Option | Meaning |
|---|---|
| `--receipt <file>` | The receipt JSON you hold; its seals are recomputed on your machine |
| `--verifier <url>` | The verifier to ask; default `https://ryntra.io/api/arc-verify` |
| `--no-verifier` | Ask no verifier; needs `--receipt` |
| `--rpc <url>` | An Arc JSON-RPC endpoint to read through; repeat for more |
| `--json` | The whole report as JSON |

| Verdict | Exit | Meaning |
|---|---|---|
| `CONFIRMED` | 0 | The receipt is intact and Arc shows what it records |
| `CONTRADICTED` | 1 | A seal is broken, the verifier holds a different receipt, or Arc shows something else |
| `INCOMPLETE` | 2 | Nothing contradicts the receipt, but something could not be checked — an unknown is never promoted to a success |

## What is checked, by kind

| Kind | Schema version | Held against the chain |
|---|---|---|
| Transfer | 1.0.0, 1.1.0 | Exactly one USDC Transfer event, of the recorded amount, from the signing wallet; the network fee; the time |
| Payout | 1.2.0 | The transaction called the USDC contract directly with no native value; exactly one USDC Transfer of the payout amount; with the file, from the treasury wallet to the beneficiary wallet the receipt names; the recorded block, block hash, position and event index; the total debit (amount plus the fee rounded up to 6 decimals) within the approved ceiling; the network fee; the time |
| Exchange | 1.3.0 | The USDC or EURC that left the signing wallet and the EURC or USDC that arrived in it, by net flow, against the recorded amounts and the approved minimum; the network fee; the time |

Every check also confirms the transaction succeeded, on the chain the receipt
names, and that each token reports the 6 decimals the receipt counts in. A
transfer receipt whose amounts describe an exchange is checked as the exchange.

## The receipt

The schema is [`packages/arc-verify/schema/receipt.schema.json`](packages/arc-verify/schema/receipt.schema.json)
(JSON Schema 2020-12), generated from the schema the Ryntra product validates
with. A receipt carries two seals, both lowercase hex SHA-256 with a `0x`
prefix:

```text
canonicalJson  = JSON with object keys in ascending UTF-16 code-unit order at every depth,
                 undefined members dropped, null kept, arrays in order, finite numbers only
core           = the receipt without `receiptHash` and `integrity`
receiptHash    = sha256(canonicalJson(core))                   schema 1.0.0, 1.1.0
               = sha256(domain + "\n" + canonicalJson(core))   schema 1.2.0 and later
integrity.hash = sha256(canonicalJson({ ...core, receiptHash }))
```

| Schema | Kind | Domain |
|---|---|---|
| 1.2.0 | Payout | `ryntra:payout-receipt:1.2.0` |
| 1.3.0 | Exchange | `ryntra:swap-receipt:1.3.0` |
| 1.4.0 | Crosschain transfer | `ryntra:bridge-receipt:1.4.0` |
| 1.5.0 | Exchange with a debit in two currencies | `ryntra:swap-receipt:1.5.0` |

The domain names the kind of record, so a payout, an exchange and a crosschain
receipt can never be presented as one another. An unknown version is refused
rather than hashed under a guess.

## Arc and Circle contracts

The verifier reads these and nothing else. Addresses come from Arc's and
Circle's documentation, and the tool reads each token's `decimals()` on every
run rather than assuming it.

| | Arc Testnet | Arc Mainnet |
|---|---|---|
| Chain id | `5042002` (`eip155:5042002`) | `5042` (`eip155:5042`) |
| USDC (ERC-20 interface, 6 decimals) | `0x3600000000000000000000000000000000000000` | `0x3600000000000000000000000000000000000000` |
| EURC (6 decimals) | `0x89b50855aa3be2f677cd6303cec089b5f319d72a` | `0xbef5f6d51cb62b58e6a8f77868681825c6fe21c1` |
| Explorer | [testnet.arcscan.app](https://testnet.arcscan.app) | [explorer.arc.io](https://explorer.arc.io) |
| JSON-RPC | `rpc.testnet.arc.io`, `rpc.blockdaemon.testnet.arc.io`, `rpc.drpc.testnet.arc.io`, `rpc.quicknode.testnet.arc.io` | `rpc.drpc.mainnet.arc.io`, `rpc.blockdaemon.mainnet.arc.io`, `rpc.mainnet.arc.io`, `rpc.quicknode.mainnet.arc.io` |

On Arc, USDC is also the native currency, with 18 decimals, and the network fee
is paid in it: a fee is `gasUsed × effectiveGasPrice` in that unit. Arc reports
every USDC movement twice — as a Transfer event of the USDC token contract and
as a native-currency event from the system address
`0xfffffffffffffffffffffffffffffffffffffffe` — and only the token contract's
own events are counted. Exchanges are routed by Circle App Kit; the verifier
reads their effect through the USDC and EURC Transfer events and does not
depend on the route's own contracts.

The JSON-RPC methods called are `eth_chainId`, `eth_getTransactionReceipt`,
`eth_getTransactionByHash`, `eth_getBlockByNumber`, `eth_blockNumber` and an
`eth_call` of `decimals()`. `scripts/verify-boundaries.mjs` asserts that list
over the shipped sources on every run.

## Use it as a library

```ts
import { verifyReceipt } from "./packages/arc-verify/src/index.ts";

const report = await verifyReceipt({ reference: "rcp_62a901894bac4b9cbdd335445e101635" });
console.log(report.verdict, report.checks);
```

`checkSeal`, `publicSummary`, `readArcTransaction` and `checkAgainstArc` are
exported on their own; see the [package README](packages/arc-verify/README.md).

## What is here

| Path | What it is |
|---|---|
| `packages/arc-verify` | The verifier: schema, seals, chain reading, checks, command line, tests |
| `lib/guard/canonical-json.ts`, `lib/guard/canonical.ts`, `lib/guard/payout-canonical.ts` | The canonical JSON and the seal functions the Ryntra product seals receipts with |
| `lib/guard/networks.ts` | The Arc network registry the product runs on |
| `lib/arc/receipt-kinds.ts` | The kind of a receipt and the fields of it a stranger may see |

These `lib/` modules are the ones the product runs on, imported rather than
copied. In the other direction, the product's receipt verifier route imports
its reference handling, seal recomputation and public summary from
`packages/arc-verify/src/receipt.ts`, so the check you run here and the answer
the verifier gives are the same code.

## Limits

- A public summary names no wallet: from a reference alone, a payout's
  treasury and recipient are `not recorded`. Hold the receipt file to check
  them.
- A transfer receipt records the amount and the transaction, not the
  recipient.
- Crosschain receipts (1.4.0) and exchanges with a debit in two currencies
  (1.5.0) are not read back from Arc; the verdict for them is `INCOMPLETE`.
- Without the receipt file, the seals are as recomputed by the verifier you
  asked. The chain reading is always your own.
- `CONFIRMED` says the receipt is intact and the chain shows what it records.
  It is not a judgement that a payment was right to make.

## Development

```bash
npm ci
npm run verify
```

`verify` runs lint, typecheck, the network-free tests and the boundary gate;
CI runs it on every push and pull request.

[Contributing](CONTRIBUTING.md) · [Security policy](SECURITY.md) ·
[Changelog](CHANGELOG.md) · [License](LICENSE) · [Notice](NOTICE)

Selected developer interfaces and evidence tooling are open source. The Ryntra
product remains proprietary. Code in this repository is Apache-2.0; the hosted
application, its operational infrastructure and live execution services are
separate.
