// Regenerates src/latex/parser.ts and src/latex/parser.terms.ts from
// src/latex/latex.grammar. Run via `pnpm generate` whenever the grammar
// changes -- the two output files are committed (not built on the fly),
// same as CodeMirror's own @codemirror/lang-* packages do it, so a
// consumer of this package doesn't need @lezer/generator at all.
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
