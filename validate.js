// Schema guard for the plantfloor MQTT messages. MQTT is a dumb pipe: it ships whatever bytes
// you publish and never checks their shape, so a message with the wrong fields slips straight
// through and the OPC UA server ends up serving `undefined` with no error. This module reads the
// message contracts in schemas/messages.schema.json (one JSON Schema per topic, keyed by topic
// the way a schema registry keys by subject) and validates a parsed message against them, turning
// a silent wrong-shape into a caught, logged rejection.
//
//   Run the self-check:  node validate.js
//   Used live by:        opcua/server.ts (rejects a bad message before reading its fields)

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import assert from "node:assert";

// Resolve the schema file relative to THIS file (not the current directory), so it loads the same
// whether it's `node validate.js` from the repo root or an import from opcua/server.ts.
const schemas = JSON.parse(
  readFileSync(new URL("./schemas/messages.schema.json", import.meta.url), "utf8")
);

// ponytail: handles only the JSON Schema features these messages use — type, properties, required,
// additionalProperties. If the schemas ever grow enums/patterns/nested $ref, swap in `ajv` (the
// standard JSON Schema validator) rather than extending this by hand.
function checkAgainst(schema, data, prefix = "") {
  const errors = [];
  const kind = (v) => (Array.isArray(v) ? "array" : v === null ? "null" : typeof v);

  if (schema.type) {
    const actual = kind(data);
    const ok =
      schema.type === "integer"
        ? actual === "number" && Number.isInteger(data)
        : actual === schema.type;
    if (!ok) {
      errors.push(`${prefix || "value"} should be ${schema.type}, got ${actual}`);
      return errors; // wrong type: no point checking the fields inside it
    }
  }

  if (schema.type === "object") {
    for (const key of schema.required ?? []) {
      if (!(key in data)) errors.push(`missing required property '${prefix}${key}'`);
    }
    const props = schema.properties ?? {};
    for (const [key, value] of Object.entries(data)) {
      if (props[key]) errors.push(...checkAgainst(props[key], value, `${prefix}${key}.`));
      else if (schema.additionalProperties === false)
        errors.push(`unexpected property '${prefix}${key}'`);
    }
  }

  return errors;
}

// Validate a parsed message for a topic. A topic with no schema is allowed through (known:false),
// so adding a brand-new topic never silently blocks it — only shapes we actually have a contract
// for get enforced.
export function validate(topic, data) {
  const schema = schemas[topic];
  if (!schema) return { ok: true, known: false, errors: [] };
  const errors = checkAgainst(schema, data);
  return { ok: errors.length === 0, known: true, errors };
}

// Runnable self-check: proves a good message passes and a wrong-shape one is caught.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const good = validate("plantfloor/matrix/temperature", { celsius: 76.2, ts: "2026-07-15T06:39:08Z" });
  assert.ok(good.ok, "a valid temperature message should pass");

  const bad = validate("plantfloor/matrix/temperature", { temp_f: 170 });
  assert.ok(!bad.ok, "a wrong-shape message should be rejected");

  console.log("valid message ->", good);
  console.log("bad message   ->", bad);
  console.log("validate.js self-check passed");
}
