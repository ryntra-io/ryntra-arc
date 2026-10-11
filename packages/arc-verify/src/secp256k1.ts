/**
 * Who signed a digest: the address recovered from an Ethereum signature on
 * secp256k1 — what `ecrecover` does on Arc, written out so this package keeps
 * no runtime dependencies.
 *
 * Only what a verifier needs, and strictly:
 *
 * - **65 bytes** `r ‖ s ‖ v`, with `v` 27 or 28 (or 0 or 1);
 * - **`0 < r < n` and `0 < s ≤ n/2`** — the low half only (EIP-2), so one
 *   signature has one spelling and a flipped `s` is not a second valid copy;
 * - **`r` is the x of the signing point** (the rare `r + n` case is not
 *   accepted — Ethereum's own `ecrecover` does not take it either).
 *
 * Arithmetic is on BigInts in Jacobian coordinates; nothing here is secret
 * (the signature and the digest are public), so constant time does not matter.
 * The tests hold it to published signatures, and the product's own tests to
 * viem's `recoverAddress` over random keys and digests.
 */

import { bytesToHex, hexToBytes, keccak256Bytes } from "./keccak.ts";

const P = 0xfffffffffffffffffffffffffffffffffffffffffffffffffffffffefffffc2fn;
const N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
const HALF_N = N >> 1n;
const GX = 0x79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798n;
const GY = 0x483ada7726a3c4655da4fbfc0e1108a8fd17b448a68554199c47d08ffb10d4b8n;

const mod = (a: bigint, m: bigint): bigint => {
  const r = a % m;
  return r >= 0n ? r : r + m;
};

function pow(base: bigint, exponent: bigint, m: bigint): bigint {
  let result = 1n;
  let b = mod(base, m);
  let e = exponent;
  while (e > 0n) {
    if (e & 1n) result = (result * b) % m;
    b = (b * b) % m;
    e >>= 1n;
  }
  return result;
}

/** Inverse modulo a prime: Fermat. */
const inverse = (a: bigint, m: bigint): bigint => pow(a, m - 2n, m);

/* A point in Jacobian coordinates (X, Y, Z) ↔ affine (X/Z², Y/Z³); Z = 0 is infinity. */
type Jacobian = readonly [bigint, bigint, bigint];
const INFINITY: Jacobian = [0n, 1n, 0n];

function double([x, y, z]: Jacobian): Jacobian {
  if (z === 0n || y === 0n) return INFINITY;
  const ysq = (y * y) % P;
  const s = (4n * x * ysq) % P;
  const m = (3n * x * x) % P; // a = 0 on secp256k1
  const nx = mod(m * m - 2n * s, P);
  const ny = mod(m * (s - nx) - 8n * ysq * ysq, P);
  const nz = (2n * y * z) % P;
  return [nx, ny, nz];
}

function add(a: Jacobian, b: Jacobian): Jacobian {
  if (a[2] === 0n) return b;
  if (b[2] === 0n) return a;
  const z1z1 = (a[2] * a[2]) % P;
  const z2z2 = (b[2] * b[2]) % P;
  const u1 = (a[0] * z2z2) % P;
  const u2 = (b[0] * z1z1) % P;
  const s1 = (a[1] * b[2] * z2z2) % P;
  const s2 = (b[1] * a[2] * z1z1) % P;
  if (u1 === u2) return s1 === s2 ? double(a) : INFINITY;
  const h = mod(u2 - u1, P);
  const r = mod(s2 - s1, P);
  const hh = (h * h) % P;
  const hhh = (h * hh) % P;
  const v = (u1 * hh) % P;
  const nx = mod(r * r - hhh - 2n * v, P);
  const ny = mod(r * (v - nx) - s1 * hhh, P);
  const nz = (a[2] * b[2] * h) % P;
  return [nx, ny, nz];
}

/** u1·G + u2·Q in one pass (Shamir's trick). */
function twoMultiples(u1: bigint, q: Jacobian, u2: bigint): Jacobian {
  const g: Jacobian = [GX, GY, 1n];
  const gq = add(g, q);
  let acc = INFINITY;
  for (let bit = 255n; bit >= 0n; bit -= 1n) {
    acc = double(acc);
    const a = (u1 >> bit) & 1n;
    const b = (u2 >> bit) & 1n;
    if (a && b) acc = add(acc, gq);
    else if (a) acc = add(acc, g);
    else if (b) acc = add(acc, q);
  }
  return acc;
}

function affine([x, y, z]: Jacobian): readonly [bigint, bigint] | null {
  if (z === 0n) return null;
  const zi = inverse(z, P);
  const zi2 = (zi * zi) % P;
  return [(x * zi2) % P, (y * zi2 * zi) % P];
}

const word = (value: bigint): Uint8Array => hexToBytes(`0x${value.toString(16).padStart(64, "0")}`);

export type SignatureParts = Readonly<{ r: bigint; s: bigint; yParity: 0 | 1 }>;

/** The parts of a 65-byte signature `r ‖ s ‖ v`, or null when it is not a well-formed low-s signature. */
export function parseSignature(signature: string): SignatureParts | null {
  if (!/^0x[0-9a-fA-F]{130}$/.test(signature)) return null;
  const r = BigInt(`0x${signature.slice(2, 66)}`);
  const s = BigInt(`0x${signature.slice(66, 130)}`);
  const v = Number.parseInt(signature.slice(130, 132), 16);
  const yParity = v === 27 || v === 0 ? 0 : v === 28 || v === 1 ? 1 : null;
  if (yParity === null) return null;
  if (r <= 0n || r >= N || s <= 0n || s > HALF_N) return null;
  return { r, s, yParity };
}

/**
 * The address that signed `digest` (32 bytes, hex) with `signature` (65 bytes,
 * hex), lowercase — or null when the signature is malformed, high-s, or names
 * no point on the curve.
 */
export function recoverAddress(digest: string, signature: string): `0x${string}` | null {
  if (!/^0x[0-9a-fA-F]{64}$/.test(digest)) return null;
  const parts = parseSignature(signature);
  if (!parts) return null;
  const { r, s, yParity } = parts;
  const x = r;
  const alpha = mod(x * x * x + 7n, P);
  let y = pow(alpha, (P + 1n) / 4n, P);
  if ((y * y) % P !== alpha) return null;
  if (Number(y & 1n) !== yParity) y = P - y;
  const e = mod(BigInt(digest), N);
  const ri = inverse(r, N);
  const u1 = mod(-e * ri, N);
  const u2 = (s * ri) % N;
  const point = affine(twoMultiples(u1, [x, y, 1n], u2));
  if (!point) return null;
  const uncompressed = new Uint8Array(64);
  uncompressed.set(word(point[0]), 0);
  uncompressed.set(word(point[1]), 32);
  return `0x${bytesToHex(keccak256Bytes(uncompressed)).slice(26)}`;
}
