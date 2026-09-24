# Security policy

## Supported release

Security fixes are accepted for the latest tagged source release. This
repository is a read-only source distribution and is not an npm package.

## Reporting

Please use the repository's private GitHub Security Advisory flow. Do not open a
public issue containing an exploit, credential, private endpoint, user data,
wallet material or provider secret.

Include the affected commit, a minimal reproduction, the impact and whether the
issue crosses any of these boundaries:

- the read-only boundary: any path that could build, sign or submit a
  transaction, hold key material, or call a state-changing RPC method;
- seal verification: any receipt whose content was changed after sealing that
  still reads as intact, or an intact receipt that reads as changed;
- chain verification: any receipt that reads as `CONFIRMED` while the chain
  shows a different status, token, amount, wallet, block, fee or time;
- unknowns: any path where an unreadable endpoint, an unanswered verifier or a
  fact the receipt does not state is reported as a match;
- the public summary: any member of it that names a tenant, an approver or a
  wallet.

Never send a seed phrase, private key, signing request or funds as part of a
report. Ryntra does not need them to reproduce an issue, and this code has no
path that would accept them.

## Security model

This code reads. It does not authorize, sign, fund, submit or settle. The only
RPC methods it calls are `eth_chainId`, `eth_getTransactionReceipt`,
`eth_getTransactionByHash`, `eth_getBlockByNumber`, `eth_blockNumber` and an
`eth_call` of a token's `decimals()`; `scripts/verify-boundaries.mjs` asserts
that list over the shipped sources on every run.

A `CONFIRMED` verdict says that a receipt is intact and that Arc shows what it
records. It is not a judgement that the payment was right to make, and it says
nothing about a transaction the receipt does not name.
