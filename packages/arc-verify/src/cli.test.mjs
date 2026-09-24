/**
 * The command line: what it refuses to start with, what it prints, and the
 * exit status a script can rely on.
 */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { USAGE, main } from "./cli.ts";
import { BENEFICIARY, TREASURY, chainWorld, fakeFetch, payoutReceipt, verifierBody } from "./test-fixtures.mjs";

const VERIFIER = "https://verifier.example/api/arc-verify";
const RPC = "https://rpc.example";

async function cli(argv, { chain = chainWorld("PAYOUT"), body = null, files = {} } = {}) {
  let stdout = "";
  let stderr = "";
  const { impl } = fakeFetch({
    worlds: { [RPC]: chain },
    verifier: { url: VERIFIER, answer: (ref) => ({ body: body ?? verifierBody(payoutReceipt(), ref) }) },
  });
  const code = await main(argv, {
    stdout: (text) => { stdout += text; },
    stderr: (text) => { stderr += text; },
    fetchImpl: impl,
    readText: async (path) => {
      if (!(path in files)) throw new Error("ENOENT");
      return files[path];
    },
  });
  return { code, stdout, stderr };
}

const ref = payoutReceipt().id;

test("a command line it cannot read exits 64 with the usage", async () => {
  for (const argv of [
    [],
    ["nonsense"],
    [ref, "--frobnicate"],
    [ref, "extra"],
    [ref, "--verifier"],
    [ref, "--rpc", "http://rpc.example"],
    ["--no-verifier", ref],
    ["--receipt", "receipt.json", "--no-verifier", "--verifier", VERIFIER],
  ]) {
    const { code, stderr } = await cli(argv);
    assert.equal(code, 64, argv.join(" "));
    assert.match(stderr, /^arc-verify: /);
    assert.ok(stderr.includes("Usage"), argv.join(" "));
  }
});

test("--help prints the usage and exits 0", async () => {
  const { code, stdout } = await cli(["--help"]);
  assert.equal(code, 0);
  assert.equal(stdout, USAGE);
});

test("a confirmed receipt prints each check and exits 0", async () => {
  const { code, stdout } = await cli([ref, "--verifier", VERIFIER, "--rpc", RPC]);
  assert.equal(code, 0, stdout);
  assert.match(stdout, /^Ryntra receipt check\n/);
  assert.match(stdout, /\n {2}receipt {5}PAYOUT · schema 1\.2\.0\n/);
  assert.match(stdout, /\n {2}match {9}amount {9}1\.000000 USDC moved, as recorded \(1\.000000\)\n/);
  assert.match(stdout, /\n {2}not recorded {2}recipient {6}the public summary does not name the recipient; the receipt file does\n/);
  assert.match(stdout, /\nCONFIRMED — The receipt is intact \(recomputed by the verifier\) and Arc shows the payout it records\.\n$/);
});

test("the report printed from a public summary names no wallet", async () => {
  const { stdout } = await cli([ref, "--verifier", VERIFIER, "--rpc", RPC]);
  assert.equal(stdout.toLowerCase().includes(TREASURY), false);
  assert.equal(stdout.toLowerCase().includes(BENEFICIARY), false);
  const json = await cli([ref, "--verifier", VERIFIER, "--rpc", RPC, "--json"]);
  assert.equal(json.stdout.toLowerCase().includes(TREASURY), false);
});

test("--json prints the whole report", async () => {
  const { code, stdout } = await cli([ref, "--verifier", VERIFIER, "--rpc", RPC, "--json"]);
  assert.equal(code, 0);
  const report = JSON.parse(stdout);
  assert.equal(report.verdict, "CONFIRMED");
  assert.equal(report.checks.length, 14);
});

test("a receipt file is read, its seals recomputed on this machine", async () => {
  const files = { "receipt.json": JSON.stringify(payoutReceipt()) };
  const { code, stdout } = await cli(["--receipt", "receipt.json", "--no-verifier", "--rpc", RPC], { files });
  assert.equal(code, 0, stdout);
  assert.match(stdout, /intact — both hashes recomputed on this machine match the recorded ones/);
  assert.match(stdout, /\n {2}match {9}recipient {6}the USDC reached the beneficiary wallet the receipt names\n/);
});

test("a contradiction exits 1 and an unknown exits 2", async () => {
  const forged = payoutReceipt();
  forged.actualEffects = { ...forged.actualEffects, amountIn: "2.000000" };
  let result = await cli(["--receipt", "forged.json", "--no-verifier", "--rpc", RPC], { files: { "forged.json": JSON.stringify(forged) } });
  assert.equal(result.code, 1);
  assert.match(result.stdout, /\nCONTRADICTED — /);

  result = await cli([ref, "--verifier", VERIFIER, "--rpc", "https://down.example"]);
  assert.equal(result.code, 2);
  assert.match(result.stdout, /skipped https:\/\/down\.example — HTTP 403/);
  assert.match(result.stdout, /\nINCOMPLETE — /);
});

test("an unreadable or non-JSON receipt file exits 64", async () => {
  assert.equal((await cli(["--receipt", "missing.json", "--no-verifier"])).code, 64);
  assert.equal((await cli(["--receipt", "bad.json", "--no-verifier"], { files: { "bad.json": "{not json" } })).code, 64);
});

test("the file runs as a program", () => {
  const output = execFileSync(process.execPath, [fileURLToPath(new URL("./cli.ts", import.meta.url)), "--help"], { encoding: "utf8" });
  assert.equal(output, USAGE);
});
