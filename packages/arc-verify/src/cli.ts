#!/usr/bin/env node
/**
 * `arc-verify` — check a Ryntra settlement receipt yourself.
 *
 *   node packages/arc-verify/src/cli.ts <reference>
 *   node packages/arc-verify/src/cli.ts --receipt receipt.json
 *
 * Exit status: 0 CONFIRMED, 1 CONTRADICTED, 2 INCOMPLETE, 64 a usage error.
 */

import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

import { normalizeReceiptReference } from "./receipt.ts";
import { DEFAULT_VERIFIER } from "./verifier.ts";
import { verifyReceipt } from "./verify.ts";
import type { VerificationReport } from "./verify.ts";

export const USAGE = `Check a Ryntra settlement receipt against Arc.

Usage
  arc-verify <reference> [options]
  arc-verify --receipt <file.json> [options]

  <reference>          the receipt id (rcp_…, rcpt_…), its operation id (int_…),
                       a seal or the transaction hash

Options
  --receipt <file>     the receipt JSON you hold; its seals are recomputed here
  --verifier <url>     the receipt verifier to ask (default ${DEFAULT_VERIFIER})
  --no-verifier        ask no verifier; needs --receipt
  --rpc <url>          an Arc JSON-RPC endpoint to read through; repeat for more
                       (default: the endpoints Arc publishes for the network)
  --json               print the whole report as JSON
  --help               print this text

Exit status
  0 CONFIRMED     the receipt is intact and Arc shows what it records
  1 CONTRADICTED  a seal is broken, or Arc shows something else
  2 INCOMPLETE    nothing contradicts it, but something could not be checked
  64              the command line could not be read
`;

export type CliIo = {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  fetchImpl?: typeof fetch;
  readText?: (path: string) => Promise<string>;
};

type Parsed = {
  reference: string | null;
  receiptPath: string | null;
  verifier: string | null;
  rpc: string[];
  json: boolean;
  help: boolean;
};

function parse(argv: readonly string[]): Parsed | string {
  const parsed: Parsed = { reference: null, receiptPath: null, verifier: DEFAULT_VERIFIER, rpc: [], json: false, help: false };
  let noVerifier = false;
  let verifierGiven = false;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const value = () => {
      const next = argv[index + 1];
      if (next === undefined || next.startsWith("--")) return null;
      index += 1;
      return next;
    };
    if (argument === "--help" || argument === "-h") parsed.help = true;
    else if (argument === "--json") parsed.json = true;
    else if (argument === "--no-verifier") noVerifier = true;
    else if (argument === "--receipt") {
      const path = value();
      if (!path) return "--receipt needs a file";
      parsed.receiptPath = path;
    } else if (argument === "--verifier") {
      const url = value();
      if (!url) return "--verifier needs a URL";
      parsed.verifier = url;
      verifierGiven = true;
    } else if (argument === "--rpc") {
      const url = value();
      if (!url) return "--rpc needs a URL";
      parsed.rpc.push(url);
    } else if (argument.startsWith("--")) return `unknown option ${argument}`;
    else if (parsed.reference === null) parsed.reference = argument;
    else return `unexpected argument ${argument}`;
  }
  if (parsed.help) return parsed;
  if (noVerifier && verifierGiven) return "--no-verifier and --verifier cannot be used together";
  if (noVerifier) parsed.verifier = null;
  if (parsed.reference !== null && normalizeReceiptReference(parsed.reference) === null) {
    return `${parsed.reference} is not a receipt reference: a receipt id, an operation id, a seal or a transaction hash`;
  }
  if (parsed.reference === null && parsed.receiptPath === null) return "name a reference or a --receipt file";
  if (parsed.verifier === null && parsed.receiptPath === null) return "--no-verifier needs a --receipt file";
  for (const url of [...parsed.rpc, ...(parsed.verifier ? [parsed.verifier] : [])]) {
    let target: URL;
    try {
      target = new URL(url);
    } catch {
      return `${url} is not a URL`;
    }
    const local = target.hostname === "localhost" || target.hostname === "127.0.0.1";
    if (target.protocol !== "https:" && !(local && target.protocol === "http:")) return `${url} must use https`;
  }
  return parsed;
}

const STATUS_WORD = { MATCH: "match", MISMATCH: "MISMATCH", NOT_RECORDED: "not recorded" } as const;

/** The report as a person reads it in a terminal. */
export function renderReport(report: VerificationReport): string {
  const lines: string[] = ["Ryntra receipt check", ""];
  const row = (label: string, value: string) => lines.push(`  ${label.padEnd(12)}${value}`);
  if (report.reference) row("reference", report.reference);
  if (report.kind) row("receipt", `${report.kind}${report.schemaVersion ? ` · schema ${report.schemaVersion}` : ""}`);
  if (report.network) row("network", `${report.network.label} · eip155:${report.network.chainId}`);
  if (report.transactionHash) row("transaction", report.transactionHash);
  if (report.explorerUrl) row("explorer", report.explorerUrl);

  lines.push("", "Seal");
  const sealWord = { INTACT: "intact", BROKEN: "BROKEN", UNREADABLE: "unreadable", NOT_CHECKED: "not checked" }[report.seal.state];
  lines.push(`  ${sealWord} — ${report.seal.detail}`);
  if (report.seal.by === "VERIFIER") lines.push("  (pass --receipt <file> to recompute them on this machine)");
  if (report.verifier.state !== "NOT_ASKED") {
    const same = report.verifier.sameReceipt === null ? "" : report.verifier.sameReceipt ? "; it holds this same receipt" : "; it holds a DIFFERENT receipt";
    lines.push(`  verifier ${report.verifier.url}: ${report.verifier.detail}${same}`);
  }

  if (report.arc.state !== "NOT_READ" || report.arc.skipped.length > 0) {
    lines.push("", "Arc");
    for (const source of report.arc.sources) lines.push(`  read through ${source}`);
    for (const note of report.arc.skipped) lines.push(`  skipped ${note.endpoint} — ${note.detail}`);
    if (report.arc.blockNumber !== null) {
      lines.push(`  block ${report.arc.blockNumber} · ${report.arc.blockTimestamp} · ${report.arc.confirmations} confirmations`);
    }
  }

  if (report.checks.length > 0) {
    lines.push("", "Checks");
    for (const check of report.checks) {
      lines.push(`  ${STATUS_WORD[check.status].padEnd(14)}${check.id.padEnd(15)}${check.detail}`);
    }
  }
  if (report.notes.length > 0) {
    lines.push("", "Notes");
    for (const note of report.notes) lines.push(`  ${note}`);
  }
  lines.push("", `${report.verdict} — ${report.reasons.join(" ")}`);
  return `${lines.join("\n")}\n`;
}

export const EXIT_CODE = { CONFIRMED: 0, CONTRADICTED: 1, INCOMPLETE: 2 } as const;

export async function main(argv: readonly string[], io: CliIo): Promise<number> {
  const parsed = parse(argv);
  if (typeof parsed === "string") {
    io.stderr(`arc-verify: ${parsed}\n\n${USAGE}`);
    return 64;
  }
  if (parsed.help) {
    io.stdout(USAGE);
    return 0;
  }
  let receipt: unknown = undefined;
  if (parsed.receiptPath !== null) {
    let raw: string;
    try {
      raw = await (io.readText ?? ((path: string) => readFile(path, "utf8")))(parsed.receiptPath);
    } catch {
      io.stderr(`arc-verify: cannot read ${parsed.receiptPath}\n`);
      return 64;
    }
    try {
      receipt = JSON.parse(raw);
    } catch {
      io.stderr(`arc-verify: ${parsed.receiptPath} is not JSON\n`);
      return 64;
    }
  }
  const report = await verifyReceipt({
    reference: parsed.reference,
    receipt,
    verifier: parsed.verifier,
    rpc: parsed.rpc,
    fetchImpl: io.fetchImpl,
  });
  io.stdout(parsed.json ? `${JSON.stringify(report, null, 2)}\n` : renderReport(report));
  return EXIT_CODE[report.verdict];
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2), {
    stdout: (text) => process.stdout.write(text),
    stderr: (text) => process.stderr.write(text),
  }).then(
    (code) => {
      process.exitCode = code;
    },
    (error: unknown) => {
      process.stderr.write(`arc-verify: ${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 2;
    },
  );
}
