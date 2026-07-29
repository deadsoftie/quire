// Regenerates parser.ts/parser.terms.ts from latex.grammar; run via `pnpm generate` after editing the grammar. Output is committed, not built on the fly.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { buildParserFile } from "@lezer/generator";

const dir = fileURLToPath(new URL("../src/latex/", import.meta.url));
const grammarPath = dir + "latex.grammar";

const source = readFileSync(grammarPath, "utf8");
const { parser, terms } = buildParserFile(source, {
  fileName: grammarPath,
  moduleStyle: "es",
  typeScript: true,
});

writeFileSync(dir + "parser.ts", parser);
writeFileSync(dir + "parser.terms.ts", terms);
console.log("Generated src/latex/parser.ts and src/latex/parser.terms.ts");
