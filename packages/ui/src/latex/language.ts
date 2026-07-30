import { HighlightStyle, LRLanguage, LanguageSupport, syntaxHighlighting } from "@codemirror/language";
import { styleTags, tags as t } from "@lezer/highlight";
import { parser } from "./parser";

const highlighting = styleTags({
  Comment: t.lineComment,
  "Command TextCommand": t.macroName,
  "BeginKw EndKw": t.keyword,
  "EnvName MathEnvName VerbatimEnvName": t.typeName,
  "InlineMath DisplayMathDollar DisplayMathBracket InlineMathParen": t.special(t.atom),
  "MathBracketOpen MathBracketClose MathParenOpen MathParenClose": t.processingInstruction,
  VerbatimBody: t.monospace,
  "{ }": t.brace,
});

// `basicSetup` already brings its own syntaxHighlighting(defaultHighlightStyle), whose colors
// assume a light background -- illegible against this app's dark editor theme. This layers a
// second, dark-appropriate style on top of it for the tags used above.
const latexHighlightStyle = HighlightStyle.define([
  { tag: t.lineComment, color: "var(--type-lo)", fontStyle: "italic" },
  { tag: t.macroName, color: "var(--nonrepro)" },
  { tag: t.keyword, color: "var(--nonrepro)", fontWeight: "600" },
  { tag: t.typeName, color: "var(--type-hi)", fontStyle: "italic" },
  { tag: t.processingInstruction, color: "var(--type-mid)" },
  { tag: t.brace, color: "var(--type-mid)" },
  { tag: t.monospace, color: "var(--type-mid)" },
]);

export const latexLanguage = LRLanguage.define({
  parser: parser.configure({ props: [highlighting] }),
  languageData: {
    commentTokens: { line: "%" },
    closeBrackets: { brackets: ["{", "["] },
  },
});

export function latex() {
  return new LanguageSupport(latexLanguage, [syntaxHighlighting(latexHighlightStyle)]);
}
