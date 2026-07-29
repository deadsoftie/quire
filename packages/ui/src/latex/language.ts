import { LRLanguage, LanguageSupport } from "@codemirror/language";
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

export const latexLanguage = LRLanguage.define({
  parser: parser.configure({ props: [highlighting] }),
  languageData: {
    commentTokens: { line: "%" },
    closeBrackets: { brackets: ["{", "["] },
  },
});

export function latex() {
  return new LanguageSupport(latexLanguage);
}
