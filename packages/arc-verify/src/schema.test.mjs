/**
 * The published receipt schema: a JSON Schema 2020-12 document, in agreement
 * with what this package reads and with the receipts it is tested on.
 */

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { RECEIPT_SCHEMA_VERSIONS } from "./receipt.ts";
import { payoutReceipt, receivedReceipt, swapReceipt, transferReceipt } from "./test-fixtures.mjs";

const schema = JSON.parse(await readFile(new URL("../schema/receipt.schema.json", import.meta.url), "utf8"));
/* A received payment is its own record, with its own schema (1.6.0). */
const receivedSchema = JSON.parse(await readFile(new URL("../schema/received-receipt.schema.json", import.meta.url), "utf8"));

test("the schema is a closed JSON Schema 2020-12 object with a title", () => {
  assert.equal(schema.$schema, "https://json-schema.org/draft/2020-12/schema");
  assert.equal(schema.title, "Ryntra settlement receipt");
  assert.equal(schema.type, "object");
  assert.equal(schema.additionalProperties, false);
});

test("between them, the two schemas name every schema version this package can hash", () => {
  assert.deepEqual([...schema.properties.schemaVersion.enum, receivedSchema.properties.schemaVersion.const], [...RECEIPT_SCHEMA_VERSIONS]);
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
});
