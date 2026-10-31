// Renders the typed @solana/kit client for the farmer_core program from its Anchor IDL.
// Run `npm run idl` first when the program changes, then `npm run codama`.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { createFromRoot } from "codama";
import { rootNodeFromAnchor } from "@codama/nodes-from-anchor";
import { renderVisitor } from "@codama/renderers-js";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const idl = JSON.parse(readFileSync(path.join(root, "idl/farmer_core.json"), "utf8"));

const codama = createFromRoot(rootNodeFromAnchor(idl));

await codama.accept(
  renderVisitor(root, {
    generatedFolder: "src/generated",
    syncPackageJson: false,
    kitImportStrategy: "preferRoot",
  }),
);
console.log("Codama client written to src/generated");
