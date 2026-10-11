/**
 * The record of Ryntra's own contracts on Arc, their fee splits and their
 * keys (schema and rules — `schema.ts`).
 *
 * A row is never written ahead of its transaction. The engine's seven contracts
 * went on Arc mainnet on 2026-10-11 (Arc v8-14), each signed by the founder's
 * wallet, each through the keyless CREATE2 deployer, the board's admin Ryntra's
 * Safe; the record of the run — `docs/arc-line/mainnet/deployments/arc-mainnet.json`.
 * Its two keys — the executor's and the receipts' — are in AWS KMS (LINE Р77), added the same day. The fee addresses Ryntra already
 * uses on Arc live in the attribution registry (`../attribution/registry.ts`,
 * served at `arc.ryntra.io/api/arc-registry`); a contract or key row may never
 * reuse one of them.
 */
import { ARC_REGISTRY_SCHEMA, type ArcRegistry } from "./schema.ts";

export const ARC_REGISTRY: ArcRegistry = {
  schema: ARC_REGISTRY_SCHEMA,
  contracts: [
    {
      kind: "contract",
      id: "locker-mainnet-1",
      contract: "RyntraLocker",
      network: "arc-mainnet",
      address: "0xda03a4b5a15743159a4d672e4f28b6e82ceac310",
      validFrom: "2026-10-11",
      validTo: null,
      mutability: "immutable",
      deployTx: "0x187b858a12fd2f226a0e69b20bcd2a3cf4c13d74ae46c331207fc2f24c1d763c",
      source: { commit: "2035e4cce648d7aa4c15908db4cfe50f2afe8913", path: "contracts/arc/src/launch/RyntraLocker.sol" },
      audit: null,
      changes: [],
    },
    {
      kind: "contract",
      id: "fee-claimer-mainnet-1",
      contract: "RyntraFeeClaimer",
      network: "arc-mainnet",
      address: "0xba5f6080cf555aecbbf40ca0da7613ce8b09a92e",
      validFrom: "2026-10-11",
      validTo: null,
      mutability: "immutable",
      deployTx: "0x8370d770cab615887a2658af80adb865f0937694019941f56d6c120d8c20d7da",
      source: { commit: "2035e4cce648d7aa4c15908db4cfe50f2afe8913", path: "contracts/arc/src/launch/RyntraFeeClaimer.sol" },
      audit: null,
      changes: [],
    },
    {
      kind: "contract",
      id: "guardian-board-mainnet-1",
      contract: "GuardianBoard",
      network: "arc-mainnet",
      address: "0x99ca0b4da1ee8960565de32c7d6f3826f5afd397",
      validFrom: "2026-10-11",
      validTo: null,
      mutability: "timelock",
      deployTx: "0x327a505d61160ccff7af6146126e661a1c22485c03a5cd422e3c9acab4394ea4",
      source: { commit: "2035e4cce648d7aa4c15908db4cfe50f2afe8913", path: "contracts/arc/src/policy/GuardianBoard.sol" },
      audit: null,
      changes: [],
    },
    {
      kind: "contract",
      id: "policy-guard-mainnet-1",
      contract: "PolicyGuard",
      network: "arc-mainnet",
      address: "0x3795eae3bfb879e71ecddc3ac5ef45f9ecf4d501",
      validFrom: "2026-10-11",
      validTo: null,
      mutability: "timelock",
      deployTx: "0xf47c8fe42370629c4c98e718736d675cc2c7be117121f9dc89fefe0930036186",
      source: { commit: "2035e4cce648d7aa4c15908db4cfe50f2afe8913", path: "contracts/arc/src/policy/PolicyGuard.sol" },
      audit: null,
      changes: [],
    },
    {
      kind: "contract",
      id: "receipt-anchor-mainnet-1",
      contract: "ReceiptAnchor",
      network: "arc-mainnet",
      address: "0xff4a4d22e84ad9c9857885a9ef57a8a10a63335b",
      validFrom: "2026-10-11",
      validTo: null,
      mutability: "immutable",
      deployTx: "0xbd6df77bf34614b9719baa8666a0e2beb090d960543ee969daaf69e6c19bd9e0",
      source: { commit: "2035e4cce648d7aa4c15908db4cfe50f2afe8913", path: "contracts/arc/src/receipts/ReceiptAnchor.sol" },
      audit: null,
      changes: [],
    },
    {
      kind: "contract",
      id: "autopilot-vault-mainnet-1",
      contract: "AutopilotVault",
      network: "arc-mainnet",
      address: "0x2b0e6824699af307f436fe97827d929e2494eca2",
      validFrom: "2026-10-11",
      validTo: null,
      mutability: "timelock",
      deployTx: "0x4d32742ea735d10feb764ba377e6557ea437b9ffd9be0241321095cdf718e0ed",
      source: { commit: "2035e4cce648d7aa4c15908db4cfe50f2afe8913", path: "contracts/arc/src/autopilot/AutopilotVault.sol" },
      audit: null,
      changes: [],
    },
    {
      kind: "contract",
      id: "autopilot-vault-factory-mainnet-1",
      contract: "AutopilotVaultFactory",
      network: "arc-mainnet",
      address: "0xe1fc8c0d47e93ece7cae54b25fd3915e680d6217",
      validFrom: "2026-10-11",
      validTo: null,
      mutability: "immutable",
      deployTx: "0xc7828e76e595e3ff5bd5bc859105cc35cdd816f6e2f7258ce97fddbcc9dcce4f",
      source: { commit: "2035e4cce648d7aa4c15908db4cfe50f2afe8913", path: "contracts/arc/src/autopilot/AutopilotVaultFactory.sol" },
      audit: null,
      changes: [],
    },
  ],
  splits: [],
  keys: [
    /* AWS KMS (us-east-1), secp256k1, never exported; reached only by the production deployment of ryntra-arc-mainnet
       through Vercel's OIDC token and the role `ryntra-arc-mainnet-signer` (kms:Sign, kms:GetPublicKey on these two). */
    {
      kind: "key",
      id: "executor-mainnet-1",
      role: "executor",
      environment: "mainnet",
      network: "arc-mainnet",
      address: "0xfb6f81b5970066a434f852a02073d7686638370d",
      validFrom: "2026-10-11",
      validTo: null,
      revokedAt: null,
    },
    {
      kind: "key",
      id: "receipt-signer-mainnet-1",
      role: "receipt-signer",
      environment: "mainnet",
      network: "arc-mainnet",
      address: "0x45d2fdbf3aa67ff02b27e47a094948cdcba03418",
      validFrom: "2026-10-11",
      validTo: null,
      revokedAt: null,
    },
  ],
};
