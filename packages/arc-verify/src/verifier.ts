/**
 * Asking a Ryntra receipt verifier about a reference.
 *
 * The verifier is the endpoint Ryntra publishes for anyone holding a receipt
 * reference: `GET <verifier>?ref=<reference>`, no account and no session. It
 * answers with a verdict — `VERIFIED`, `TAMPERED` or `NOT_FOUND` — the public
 * summary of the receipt and the two seals it recomputed.
 *
 * Its answer is treated as untrusted input like any other: parsed member by
 * member, and a malformed answer is reported as malformed rather than read as
 * a verdict. What the verifier says about the chain is never taken on its
 * word; that is what the rest of this package checks.
 */

import { lowerHash, object, text } from "./receipt.ts";
import type { HashCheck, Json, SealReport, VerifierVerdict } from "./receipt.ts";

/** Ryntra's public receipt verifier. */
export const DEFAULT_VERIFIER = "https://ryntra.io/api/arc-verify";

export type VerifierAnswer =
  | Readonly<{
      state: "ANSWERED";
      verdict: VerifierVerdict;
      receiptRef: string;
      kind: string | null;
      summary: Json | null;
      integrity: SealReport | null;
    }>
  | Readonly<{ state: "UNREACHABLE" | "REFUSED" | "INVALID"; detail: string }>;

const VERDICTS: readonly VerifierVerdict[] = ["VERIFIED", "TAMPERED", "NOT_FOUND"];

function hashCheck(value: unknown): HashCheck | null {
  const check = object(value);
  const recorded = lowerHash(check?.recorded);
  const recomputed = lowerHash(check?.recomputed);
  if (!check || !recorded || !recomputed || typeof check.matches !== "boolean") return null;
  if (check.matches !== (recorded === recomputed)) return null;
  return { recorded, recomputed, matches: check.matches };
}

function sealReport(value: unknown): SealReport | null {
  const report = object(value);
  if (!report) return null;
  const receiptHash = hashCheck(report.receiptHash);
  const integrityHash = hashCheck(report.integrityHash);
  const algorithm = text(report.algorithm);
  if (!receiptHash || !integrityHash || algorithm !== "SHA-256") return null;
  return { algorithm, schemaVersion: text(report.schemaVersion), receiptHash, integrityHash };
}

/** Read one verifier response body. Exported for tests and for callers with their own transport. */
export function readVerifierAnswer(status: number, body: unknown): VerifierAnswer {
  const envelope = object(body);
  if (status !== 200) {
    const error = object(envelope?.error);
    const code = text(error?.code);
    return { state: "REFUSED", detail: code ? `HTTP ${status} ${code}` : `HTTP ${status}` };
  }
  const data = object(envelope?.data);
  const verdict = VERDICTS.find((entry) => entry === data?.verdict);
  const receiptRef = text(data?.receiptRef);
  if (!data || !verdict || !receiptRef) return { state: "INVALID", detail: "the answer carries no verdict" };
  const summary = data.summary === null ? null : object(data.summary);
  const integrity = data.integrity === null ? null : sealReport(data.integrity);
  if (verdict === "VERIFIED") {
    if (!summary || !integrity) return { state: "INVALID", detail: "a VERIFIED answer without its summary or both seals" };
    if (!integrity.receiptHash.matches || !integrity.integrityHash.matches) {
      return { state: "INVALID", detail: "a VERIFIED answer whose own seals do not match" };
    }
  }
  if (verdict === "TAMPERED" && (!integrity || (integrity.receiptHash.matches && integrity.integrityHash.matches))) {
    return { state: "INVALID", detail: "a TAMPERED answer that does not show which seal failed" };
  }
  const kind = text(data.kind) ?? text(summary?.kind);
  return { state: "ANSWERED", verdict, receiptRef, kind, summary: verdict === "VERIFIED" ? summary : null, integrity };
}

/** The verifier's answer for one reference. */
export async function askVerifier(
  reference: string,
  { verifier = DEFAULT_VERIFIER, fetchImpl = fetch, timeoutMs = 20_000 }: { verifier?: string; fetchImpl?: typeof fetch; timeoutMs?: number } = {},
): Promise<VerifierAnswer> {
  let url: URL;
  try {
    url = new URL(verifier);
  } catch {
    return { state: "UNREACHABLE", detail: "the verifier address is not a URL" };
  }
  url.searchParams.set("ref", reference);
  let response: Response;
  try {
    response = await fetchImpl(url, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(timeoutMs) });
  } catch (error) {
    return { state: "UNREACHABLE", detail: error instanceof Error && error.name === "TimeoutError" ? "timed out" : "could not be reached" };
  }
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    if (response.status === 200) return { state: "INVALID", detail: "the answer is not JSON" };
  }
  return readVerifierAnswer(response.status, body);
}
