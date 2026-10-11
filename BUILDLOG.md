# Ryntra on Arc — build log

## 2026-10-11 — A trading key for a day, and one question before it

Trading on the futures page at
[arc.ryntra.io/app/futures](https://arc.ryntra.io/app/futures) now stays on
in your browser for one day — or three or seven, if you choose — instead of
thirty. An hour before it ends, the page tells you when, and «Extend» turns it
on again with one signature. A thirty-day key from before is let go at once,
with nothing to sign.

Before your first trading key, the page asks once that you are not from the
US, Ontario or a sanctioned country — the places Hyperliquid's own terms leave
out. Ryntra blocks no one by location: it keeps the date and your wallet
address, tied to the approval your wallet signs, and you can always close your
positions on Hyperliquid itself.

A top-up from Arc is sent only to Circle's forwarder for your own Hyperliquid
account; anything else is refused before your wallet is asked.

## 2026-10-11 — Futures orders that know their own outcome

Every order on the futures page at arc.ryntra.io/app/futures now carries its
own id from the moment you press the button, before Hyperliquid has answered,
and a deadline: if it reaches Hyperliquid late, Hyperliquid turns it down
instead of filling it at a price you no longer expect.

When Hyperliquid does not answer, the page no longer asks you to go and
check. It looks the order up by that id itself and tells you what happened —
opened, or not placed at all — and it never sends the same order twice on
its own. If it was not placed, «Try again» makes a new one, which is safe.

Before anything is signed, the order is checked against what Hyperliquid
would refuse — its price step, its lot, the $10 minimum, your free money —
and against how many actions Hyperliquid still allows your address. Closing
a position is never held back by any of these. The ticket looks the same.

## 2026-10-11 — Markets: every market on Arc in one list

[arc.ryntra.io/app/markets](https://arc.ryntra.io/app/markets) lists every
market on Arc — every pool of Uniswap and Aerodrome, read from the network
itself, not only the ones launched with Ryntra. Pick which markets — on the
market, new today, live launch curves, or run by Ryntra rules — and the order:
the day's volume, traders, new holders over a day or a week, or the newest.
Search finds a coin by name, symbol or address.

Each row shows the price and its day, volume, depth within 10 % of the price,
holders and its Market Health. A coin that borrows the name of USDC, EURC,
cirBTC or WETH is marked «Not the real one» and never leads the list; a
search for a real asset shows the real one first.

Each market has one page with five sections: Trade (the live chart and an
order checked before you sign), Rules (the pool's fee, who can change it,
locked liquidity, the code on every trade, Ryntra rules), Data (Health with
every criterion against its threshold, and the market's facts), Journal and
Rewards. Spot's list became Markets: its old address opens here.

## 2026-10-10 — The futures page on one live connection

The futures page at arc.ryntra.io/app/futures now keeps one live connection
to Hyperliquid per browser tab, run in the background off the page itself:
the chart, the market's numbers, your account and your trades all arrive
over it as they change, instead of being asked for again every few seconds.
If the connection drops, it comes back by itself and the page catches up on
what it missed; while it is down, the page reads the same numbers the old
way, so nothing goes blank.

An order at the market now takes its price from that live feed only when it
is at most two seconds old — older, it asks Hyperliquid at the moment of the
click, as before. And next to your balance the page now shows how many
orders Hyperliquid still allows your address: one for every dollar traded,
ten thousand to start.

## 2026-10-10 — Market Health and the facts behind every market on Arc

Every market on Arc now comes with the facts a buyer should see before
trading, each with where it came from: how much of its liquidity nobody can
take out, who can change what a trade pays, how much the ten largest
holders hold, how old the token and the market are, and whether any rules
run it (a market no Ryntra rule runs has no receipts — nothing acts on it).
Facts, not verdicts: nothing is called safe or risky.

On top of them, Market Health names one of five states — Healthy, Watch,
Thin, Stressed or Paused — always with the criterion that put the market
there and the threshold it was measured against: depth within 10 % of the
price, steady volume, the share of the ten largest holders, and the fall of
the last 24 hours. A market younger than a day has no state yet: Health
appears 24 hours after it was created. A state is named only when every
fact that could change it was read.

The organic share is coming too: of a market's volume, the part traded by
wallets that had held the token at least seven days. It starts counting
once the record's history is complete, and shows eight days later.

Thresholds and methodology are published with every answer at
arc.ryntra.io/api/arc-markets (`?pool=` or `?token=`); the markets page
shows them next.

## 2026-10-10 — Every pool on Arc, read from the chain

Ryntra now keeps its own record of every pool on Arc — Uniswap v4,
Uniswap v3 and Aerodrome — read straight from the chain, not from an
aggregator: each pool, each swap, each position and who holds it, and the
holders of every token traded in them. For each market it tells where the
pool came from (which launchpad opened it), how much of its liquidity
nobody can take out (burned or held by a launchpad's locker), who can
change the fee a trade pays, how much it traded in the last day, and how
the token's supply is spread — the share of the ten largest holders, with
pools, burn addresses and lockers left out.

Every number names where it came from: the events and blocks it was summed
from, or the contract call that answered it. The record follows Arc's head
within a few seconds, checks that each block it reads continues the chain
it already holds, and stops rather than show a chain that does not
continue. History from the network's first block is filling in now; until
it is complete and counted again against a second source, facts that need
all of it are shown as not yet read.

It is open to read at arc.ryntra.io/api/arc-markets — the markets of the
day, one market (`?pool=`) or one token (`?token=`). The markets page built
on it comes next.

## 2026-10-10 — The futures trading key, sealed in the browser

The key that lets the futures page trade for a person — approved once by
their own wallet, never able to withdraw — is now kept in the browser
sealed: encrypted under a key the browser's own cryptography makes and
never lets a page read out. A key kept the old way moves there by itself
the next time the page opens, with no new signature, and the old copy is
erased.

The key can now sign the venue's own trading actions the coming terminal
needs — changing an order, cancelling by the page's own order id, trailing
stops, TWAP and isolated margin — and still never a transfer, a withdrawal
or a change of how the account is margined. Every one of these actions was
checked byte for byte against Hyperliquid's own SDK and against the live
venue. Only the page's main window signs, one action at a time across tabs.

Nothing changes on screen: arc.ryntra.io/app/futures.

## 2026-10-09 — The portfolio on Arc, and forgotten money in one signature

One page shows everything a wallet has on Arc: its coins, its deposits,
loans and collateral in Morpho and Aave, its Uniswap pools, and the rewards
protocols credited to it — each read from the chain or from the protocol's
own data, with the total and what it is made of. Circle's assets are marked
official; a coin that copies their name from another address is marked as
not the real one, comes first, and is never counted as money. Where a
deposit sits in a market that is lent out, the page says how much can be
withdrawn now, and why the rest waits.

Rewards waiting on Arc and pool fees not yet collected are taken in one
signature from the person's own wallet, with no fee from Ryntra. The batch
holds two kinds of calls only — Merkl's claim and Uniswap's collect — and
both pay the signer: the server checks the bytes, tries each call as the
signer first, and leaves out a reward the chain says was already taken or
that pays another address; the browser reads the bytes again before the
wallet sees them. The same batch sent from any other address fails on the
contracts themselves.

The page is at arc.ryntra.io/app/portfolio; any address can be looked at,
and only its owner, signed in, can claim.

## 2026-10-09 — Futures on Hyperliquid, from Arc

Futures trade on Hyperliquid from a person's own wallet. Money moves from
their wallet on Arc to their own Hyperliquid account through Circle, and
back to Arc the same way; Ryntra never holds it. Before the button, the
ticket says what the position risks in dollars, where it is liquidated and
how far that is, and both fees — Hyperliquid's and Ryntra's 0.05 %, on its
own line. Leverage starts at 2x, goes up to 20x on BTC, ETH and SOL and to
10x elsewhere, and above 5x asks once that the person understands
liquidation. Every position has its own margin: the amount put in is the
most it can lose.

Trading uses a key that lives only in the person's browser. Hyperliquid
lets it trade the account but never withdraw or send money — that always
needs the person's wallet; it expires in 30 days and turns off with one
tap. Closing a position needs only that key, also while futures are paused.
Short of money, the one action is the top-up that covers the order, with
Circle's fee included.

The page is at arc.ryntra.io/app/futures; it joins the menu after a first
live trade.

## 2026-10-08 — Spot on every Arc pair, with a live chart

Spot now lists every pair on Arc with at least $1,000 of liquidity — the
most traded, the trending, the new, and any coin found by name, symbol or
address. A pair is one market, answered by its deepest pool. The real
USDC, EURC, cirBTC and WETH come first, by their addresses; a pair holding
a token that copies one of their names is marked as not the real one and
listed last.

The chart moves on its own: a frame's history is read rarely, and the
market's minute candles keep its last candle live, while each new trade
moves it in the browser between reads. Market data is read once per
market for everyone — the server's instances share one cache and ask the
data source one at a time — and an answer that could not be refreshed
says how old it is. The latest trades sit under the chart; the candle
period a person picks is remembered.

An order is the same guarded Swap. A coin that is not one of the real
assets shows its facts — age, liquidity, holders, tax — before the button,
and the button waits for them; a copy offers the real asset first. The
price impact of a coin is measured on the route itself, against a much
smaller amount on the same route.

## 2026-10-08 — Swap any token on Arc

Swap now takes any token on Arc. USDC, EURC and cirBTC swap through
Circle's App Kit Swap; every other token through KyberSwap, across Arc's
pools. The token list puts the real USDC, EURC, cirBTC and WETH first, by
their addresses, and marks a token that copies one of their names as not
the real one before it can be picked. Any other token comes with a short
check read a moment ago — the age of its first pool, its liquidity, how
many hold it, its creator when known, a tax on buying or selling — as
facts, not a verdict.

Ryntra's fee follows the swap's class: 1 % on new tokens, 0.5 % on listed
tokens older than a week, 0.25 % on bitcoin and ether, and 0.2 % between
USDC and EURC. It is shown before signing and paid in the
swap itself, to Ryntra's fee address on Arc; a swap between two tokens
that are neither USDC, EURC, cirBTC nor WETH carries no fee. Before a
payment or a swap is signed, the wallet is asked whether its own
connection reaches Arc; when it does not, the page says so and offers a
connection that works.

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
