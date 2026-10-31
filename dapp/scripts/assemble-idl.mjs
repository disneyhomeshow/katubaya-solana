// Assembles the Anchor IDL from the output of
//   cargo test __anchor_private_print_idl --features idl-build -- --show-output --quiet
// the same way `anchor idl build` does, for machines without the Anchor CLI.
// Usage: node scripts/assemble-idl.mjs <raw-output.txt> <out.json>
import { readFileSync, writeFileSync } from "node:fs";

const [, , input, output] = process.argv;
if (!input || !output) {
  console.error("usage: assemble-idl.mjs <raw-output.txt> <out.json>");
  process.exit(1);
}

const raw = readFileSync(input, "utf8");
const sections = [...raw.matchAll(/--- IDL begin (\w+) ---\n([\s\S]*?)\n--- IDL end \1 ---/g)];

let idl = null;
let address = null;
const events = [];
const eventTypes = [];
let errors = [];
const constants = [];

for (const [, kind, body] of sections) {
  const value = JSON.parse(body);
  if (kind === "program") idl = value;
  else if (kind === "address") address = JSON.parse(value);
  else if (kind === "event") {
    events.push(value.event);
    eventTypes.push(...value.types);
  } else if (kind === "errors") errors = value;
  else if (kind === "constant") constants.push(value);
}

if (!idl) throw new Error("no program section in the cargo output");

idl.address = address ?? idl.address;
idl.events = events.sort((a, b) => a.name.localeCompare(b.name));
idl.errors = errors;
if (constants.length) idl.constants = constants;

const seen = new Set((idl.types ?? []).map((t) => t.name));
for (const t of eventTypes) if (!seen.has(t.name) && seen.add(t.name)) idl.types.push(t);
const short = (n) => n.split("::").pop();
idl.types.sort((a, b) => short(a.name).localeCompare(short(b.name)));

// Strip module paths (`farmer_core::events::OrderCreated` -> `OrderCreated`), as the CLI does.
const json = JSON.stringify(idl, null, 2).replace(/"(?:[a-z_][a-z0-9_]*::)+([A-Za-z_][A-Za-z0-9_]*)"/g, '"$1"');
writeFileSync(output, json + "\n");
console.log(`IDL written to ${output}: ${idl.instructions.length} instructions, ${idl.accounts?.length ?? 0} accounts, ${events.length} events, ${errors.length} errors`);
