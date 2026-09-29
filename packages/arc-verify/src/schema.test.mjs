/**
 * The published receipt schema: a JSON Schema 2020-12 document, in agreement
 * with what this package reads and with the receipts it is tested on.
 */

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { RECEIPT_SCHEMA_VERSIONS } from "./receipt.ts";
import { bridgeReceipt, payoutReceipt, receivedReceipt, relaySwapRouteReceipt, swapReceipt, swapRouteReceipt, transferReceipt } from "./test-fixtures.mjs";

const schema = JSON.parse(await readFile(new URL("../schema/receipt.schema.json", import.meta.url), "utf8"));
/* A received payment is its own record, with its own schema (1.6.0). */
const receivedSchema = JSON.parse(await readFile(new URL("../schema/received-receipt.schema.json", import.meta.url), "utf8"));
/* So is a transfer into or out of Arc (1.7.0). */
const bridgeSchema = JSON.parse(await readFile(new URL("../schema/bridge-receipt.schema.json", import.meta.url), "utf8"));
/* And a route on any rail of the bridge, with the integrator's fee as its own line (1.8.0). */
const routeSchema = JSON.parse(await readFile(new URL("../schema/route-receipt.schema.json", import.meta.url), "utf8"));
/* And a swap on Arc through an aggregator's router, with Ryntra's fee as its own line (1.9.0). */
const swapSchema = JSON.parse(await readFile(new URL("../schema/swap-receipt.schema.json", import.meta.url), "utf8"));

test("the schema is a closed JSON Schema 2020-12 object with a title", () => {
  assert.equal(schema.$schema, "https://json-schema.org/draft/2020-12/schema");
  assert.equal(schema.title, "Ryntra settlement receipt");
  assert.equal(schema.type, "object");
  assert.equal(schema.additionalProperties, false);
});

test("between them, the five schemas name every schema version this package can hash", () => {
  assert.deepEqual(
    [
      ...schema.properties.schemaVersion.enum,
      receivedSchema.properties.schemaVersion.const,
      bridgeSchema.properties.schemaVersion.const,
      routeSchema.properties.schemaVersion.const,
      swapSchema.properties.schemaVersion.const,
    ],
    [...RECEIPT_SCHEMA_VERSIONS],
  );
});

test("the route schema is a closed JSON Schema 2020-12 object that requires both sides, the quote, the fee line and the anchor on Arc", () => {
  assert.equal(routeSchema.$schema, "https://json-schema.org/draft/2020-12/schema");
  assert.equal(routeSchema.title, "Ryntra bridge route receipt");
  assert.equal(routeSchema.additionalProperties, false);
  for (const member of ["schemaVersion", "id", "route", "execution", "actualEffects", "reconciliation", "finalizedAt", "receiptHash", "integrity"]) {
    assert.ok(routeSchema.required.includes(member), member);
  }
  for (const member of ["rail", "provider", "source", "destination", "quote", "ryntraFee", "providerFee", "attestation", "direction"]) {
    assert.ok(routeSchema.properties.route.required.includes(member), member);
  }
});

test("the swap schema is a closed JSON Schema 2020-12 object that requires what was paid and received, the quote, the fee line and the anchor on Arc", () => {
  assert.equal(swapSchema.$schema, "https://json-schema.org/draft/2020-12/schema");
  assert.equal(swapSchema.title, "Ryntra swap receipt");
  assert.equal(swapSchema.additionalProperties, false);
  for (const member of ["schemaVersion", "id", "swap", "execution", "actualEffects", "reconciliation", "finalizedAt", "receiptHash", "integrity"]) {
    assert.ok(swapSchema.required.includes(member), member);
  }
  for (const member of ["provider", "chainRef", "tokenIn", "tokenOut", "paid", "received", "quote", "ryntraFee", "networkFee", "deviations"]) {
    assert.ok(swapSchema.properties.swap.required.includes(member), member);
  }
});

test("the bridge schema is a closed JSON Schema 2020-12 object that requires both sides, the attestation and the anchor on Arc", () => {
  assert.equal(bridgeSchema.$schema, "https://json-schema.org/draft/2020-12/schema");
  assert.equal(bridgeSchema.title, "Ryntra bridge transfer receipt");
  assert.equal(bridgeSchema.additionalProperties, false);
  for (const member of ["schemaVersion", "id", "bridge", "execution", "actualEffects", "reconciliation", "finalizedAt", "receiptHash", "integrity"]) {
    assert.ok(bridgeSchema.required.includes(member), member);
  }
  for (const member of ["source", "attestation", "destination", "amounts", "direction", "asset"]) {
    assert.ok(bridgeSchema.properties.bridge.required.includes(member), member);
  }
});

test("the received-payment schema is a closed JSON Schema 2020-12 object that requires what the seals and the chain checks read", () => {
  assert.equal(receivedSchema.$schema, "https://json-schema.org/draft/2020-12/schema");
  assert.equal(receivedSchema.title, "Ryntra received-payment receipt");
  assert.equal(receivedSchema.additionalProperties, false);
  for (const member of ["schemaVersion", "id", "received", "finalizedAt", "receiptHash", "integrity"]) {
    assert.ok(receivedSchema.required.includes(member), member);
  }
  for (const member of ["amount", "asset", "payee", "payer", "paidAt", "transactionHash", "payerReceipt"]) {
    assert.ok(receivedSchema.properties.received.required.includes(member), member);
  }
});

test("everything the seals and the chain checks read is required, or a version-gated block", () => {
  for (const member of ["schemaVersion", "id", "intent", "execution", "actualEffects", "expectedEffects", "reconciliation", "finalizedAt", "receiptHash", "integrity"]) {
    assert.ok(schema.required.includes(member), member);
  }
  for (const block of ["payout", "swap", "bridge"]) {
    assert.ok(schema.properties[block], block);
    assert.equal(schema.required.includes(block), false, `${block} is present only on its own schema version`);
  }
  assert.deepEqual(schema.properties.integrity.properties.algorithm, { type: "string", const: "SHA-256" });
});

/** Every member of `value` is declared by `node`, recursively through objects. */
function undeclared(node, value, path = "$") {
  if (!node || typeof value !== "object" || value === null || Array.isArray(value) || node.type !== "object") return [];
  const problems = [];
  for (const [key, member] of Object.entries(value)) {
    const declared = node.properties?.[key];
    if (!declared) {
      if (node.additionalProperties === false) problems.push(`${path}.${key}`);
      continue;
    }
    problems.push(...undeclared(declared.anyOf?.find((option) => option.type === "object") ?? declared, member, `${path}.${key}`));
  }
  for (const key of node.required ?? []) if (!(key in value)) problems.push(`${path}.${key} (required)`);
  return problems;
}

test("each test receipt uses only members the schema declares, and every member it requires", () => {
  for (const receipt of [payoutReceipt(), transferReceipt(), swapReceipt()]) {
    assert.deepEqual(undeclared(schema, receipt), [], receipt.schemaVersion);
  }
  assert.deepEqual(undeclared(receivedSchema, receivedReceipt()), [], "1.6.0");
  assert.deepEqual(undeclared(bridgeSchema, bridgeReceipt()), [], "1.7.0");
  assert.deepEqual(undeclared(swapSchema, swapRouteReceipt()), [], "1.9.0");
  assert.deepEqual(undeclared(swapSchema, relaySwapRouteReceipt()), [], "1.9.0 through Relay");
});
