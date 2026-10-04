# Ryntra Guard build log

## 2026-10-04 — Spot on verified pairs, honest refusals

Spot now lists three markets of official assets against USDC — cirBTC,
WETH and EURC — and nothing else. For each pair the server picks the
deepest pool whose two tokens are exactly the official addresses, so a
copycat token cannot become a market; prices, candles and latest trades
come from that pool, in USDC. An order is the same guarded Swap: fresh
prices, an exact plan, a check before the wallet signs, and a receipt.

A send the wallet cannot cover is now refused as a shortfall instead of
being reported as the network being unreadable. Bridge routes that keep a
large share of the amount say so before signing, and two dollar
stablecoins are compared one for one when a provider gives no dollar
prices. A deposit address for a transfer from Tron or Bitcoin appears on
the page as soon as it is made, and a token's own contract is refused as
a refund address. Sign-in without a wallet in the browser explains what
to do instead of leaving a disabled button.

## 2026-09-30 — A stable result after swapping

Completed swaps retain their result, completed steps and receipt when the
wallet returns focus or the page reloads. Approval status refreshes
automatically from the exact transaction, even after its allowance was
spent. Unknown outcomes remain visible. Starting another swap is explicit,
so a completed result is not replaced by a new quote or a low-balance prompt.

## 2026-09-30 — Relay swaps and accessible receipts

New swaps use Relay while KyberSwap is paused. Existing operations and their
receipts remain accessible. A confirmed swap receives its receipt without
waiting for Relay to finish indexing the app fee: an unread fee is stated
as unread, never as collected or zero. Completed swaps in history link
directly to their receipts.

## 2026-09-30 — Approval recovery and returned fee accounting

Swap keeps unresolved token approvals across reloads and provides a status
check and transaction link. A price expiring does not erase a pending approval.
Approval confirmation uses the app's chain checks; the swap still requires
its own current validation and wallet signature.

KyberSwap can prepare swaps for the wallet that receives the app fee, with
net balance changes and the returned fee verified separately. Native Bridge
network groups and options use readable colors in both display themes.

## 2026-09-30 — App access without IP geography filtering

The app no longer filters its pages, APIs or swap and bridge choices by the
visitor's IP country or region. This also removes the app's additional
country filter for Circle services.

Provider availability and responses still determine which routes can be
used. Address screening, wallet authorization, balance and transaction
checks remain in place.

## 2026-09-29 — Swap and bridge with wallet balances

[Swap](https://arc.ryntra.io/app/swap) and [Bridge](https://arc.ryntra.io/app/bridge)
are available on Arc Mainnet.

- Swap compares executable quotes from KyberSwap and Relay. Select a token
  from the supported list, see its wallet balance, and choose 25%, 50%, 75%
  or Max. The amount controls reserve network gas when the spending asset
  also pays it.
- The bridge shows the sending network's supported balances and amount
  controls. Native-asset Max uses a fresh network-gas estimate; when that
  estimate is unavailable, enter an amount and review the resulting plan.
- Quotes show the minimum received and distinguish Ryntra's fee, provider
  costs and network gas. Ryntra charges 0.10% for USDC/EURC swaps and 0.20%
  for other supported swaps and bridge routes.
- The wallet signs each action. The interface keeps pending activity
  recoverable, reports the observed outcome and links the resulting receipt.
  A prepared or submitted transaction is not presented as a settled one.

Route availability depends on the selected networks, asset, amount and
provider. Network-gas figures are estimates; the wallet confirms the actual
transaction before signing.

This repository publishes receipt verification tools. The application remains
proprietary. The current verifier release is [0.7.0](https://github.com/ryntra-io/ryntra-arc/releases/tag/v0.7.0).
