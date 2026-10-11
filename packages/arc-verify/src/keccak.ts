/**
 * Keccak-256 — the hash Ethereum and Arc use for addresses, events and EIP-712 —
 * written out here so this package keeps no runtime dependencies.
 *
 * It is the original Keccak submission with the padding byte 0x01 (not SHA3-256,
 * which pads with 0x06 and gives other digests); rate 1088 bits, capacity 512,
 * 24 rounds of Keccak-f[1600] over 25 lanes of 64 bits. Lanes are BigInts masked
 * to 64 bits: slower than a 32-bit split, plain to read, and a verifier hashes a
 * few hundred bytes per receipt.
 *
 * The tests hold it to published vectors (`crypto.test.mjs`), and the product's
 * own tests hold it to viem's implementation over random inputs.
 */

const MASK = (1n << 64n) - 1n;
const RATE_BYTES = 136;

/* The round constants and rotation offsets of Keccak-f[1600] (FIPS 202, the step mappings). */
const ROUND_CONSTANTS = [
  0x0000000000000001n, 0x0000000000008082n, 0x800000000000808an, 0x8000000080008000n,
  0x000000000000808bn, 0x0000000080000001n, 0x8000000080008081n, 0x8000000000008009n,
  0x000000000000008an, 0x0000000000000088n, 0x0000000080008009n, 0x000000008000000an,
  0x000000008000808bn, 0x800000000000008bn, 0x8000000000008089n, 0x8000000000008003n,
  0x8000000000008002n, 0x8000000000000080n, 0x000000000000800an, 0x800000008000000an,
  0x8000000080008081n, 0x8000000000008080n, 0x0000000080000001n, 0x8000000080008008n,
];
/* ROTATIONS[x + 5y] — ρ's offset for lane (x, y). */
const ROTATIONS = [0, 1, 62, 28, 27, 36, 44, 6, 55, 20, 3, 10, 43, 25, 39, 41, 45, 15, 21, 8, 18, 2, 61, 56, 14];

const rotl = (lane: bigint, by: number): bigint => (by === 0 ? lane : ((lane << BigInt(by)) | (lane >> BigInt(64 - by))) & MASK);

function permute(state: bigint[]): void {
  const c = new Array<bigint>(5);
  const b = new Array<bigint>(25);
  for (let round = 0; round < 24; round += 1) {
    // θ
    for (let x = 0; x < 5; x += 1) c[x] = state[x] ^ state[x + 5] ^ state[x + 10] ^ state[x + 15] ^ state[x + 20];
    for (let x = 0; x < 5; x += 1) {
      const d = c[(x + 4) % 5] ^ rotl(c[(x + 1) % 5], 1);
      for (let y = 0; y < 25; y += 5) state[x + y] ^= d;
    }
    // ρ and π: lane (x, y) moves to (y, 2x + 3y)
    for (let x = 0; x < 5; x += 1) {
      for (let y = 0; y < 5; y += 1) b[y + 5 * ((2 * x + 3 * y) % 5)] = rotl(state[x + 5 * y], ROTATIONS[x + 5 * y]);
    }
    // χ
    for (let y = 0; y < 25; y += 5) {
      for (let x = 0; x < 5; x += 1) state[x + y] = b[x + y] ^ (~b[((x + 1) % 5) + y] & MASK & b[((x + 2) % 5) + y]);
    }
    // ι
    state[0] ^= ROUND_CONSTANTS[round];
  }
}

/** Keccak-256 of `bytes`: 32 bytes. */
export function keccak256Bytes(bytes: Uint8Array): Uint8Array {
  const state = new Array<bigint>(25).fill(0n);
  /* Pad: the message, 0x01, zeros, and 0x80 on the last byte of the block (0x81 when they coincide). */
  const blocks = Math.floor(bytes.length / RATE_BYTES) + 1;
  const padded = new Uint8Array(blocks * RATE_BYTES);
  padded.set(bytes);
  padded[bytes.length] ^= 0x01;
  padded[padded.length - 1] ^= 0x80;
  for (let offset = 0; offset < padded.length; offset += RATE_BYTES) {
    for (let lane = 0; lane < RATE_BYTES / 8; lane += 1) {
      let value = 0n;
      for (let i = 7; i >= 0; i -= 1) value = (value << 8n) | BigInt(padded[offset + lane * 8 + i]);
      state[lane] ^= value;
    }
    permute(state);
  }
  const out = new Uint8Array(32);
  for (let lane = 0; lane < 4; lane += 1) {
    let value = state[lane];
    for (let i = 0; i < 8; i += 1) {
      out[lane * 8 + i] = Number(value & 0xffn);
      value >>= 8n;
    }
  }
  return out;
}

const HEX = /^0x(?:[0-9a-fA-F]{2})*$/;

/** Bytes of a `0x`-prefixed hex string of whole bytes; anything else throws. */
export function hexToBytes(hex: string): Uint8Array {
  if (!HEX.test(hex)) throw new TypeError("not hex of whole bytes");
  const out = new Uint8Array((hex.length - 2) / 2);
  for (let i = 0; i < out.length; i += 1) out[i] = Number.parseInt(hex.slice(2 + i * 2, 4 + i * 2), 16);
  return out;
}

/** Lowercase `0x` hex of `bytes`. */
export function bytesToHex(bytes: Uint8Array): `0x${string}` {
  let out = "0x";
  for (const byte of bytes) out += byte.toString(16).padStart(2, "0");
  return out as `0x${string}`;
}

/** Keccak-256 of hex bytes, as lowercase hex. */
export function keccak256Hex(hex: string): `0x${string}` {
  return bytesToHex(keccak256Bytes(hexToBytes(hex)));
}

/** Keccak-256 of a string's UTF-8 bytes, as lowercase hex. */
export function keccak256Text(text: string): `0x${string}` {
  return bytesToHex(keccak256Bytes(new TextEncoder().encode(text)));
}
