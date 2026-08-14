import { HighlightStyle, LRLanguage, LanguageSupport, syntaxHighlighting } from "@codemirror/language";
import { styleTags, tags as t } from "@lezer/highlight";
import { parser } from "./parser";

// The four inline/display math node shapes this grammar produces; exported so editorModes.ts can build its own node set without re-typing this list.
export const MATH_DELIMITED_NODE_NAMES = ["InlineMath", "DisplayMathDollar", "DisplayMathBracket", "InlineMathParen"];

const highlighting = styleTags({
  Comment: t.lineComment,
  Command: t.macroName,
  // A variant of macroName - same family as a bare command, but reads visually distinct for \textbf/\emph/etc.
  TextCommand: t.special(t.macroName),
  SectionCommand: t.heading,
  RefCommand: t.link,
  "BeginKw EndKw": t.keyword,
  "EnvName MathEnvName": t.typeName,
  // A variant of typeName, grouping a verbatim environment's name with its monospace body.
  VerbatimEnvName: t.special(t.typeName),
  [MATH_DELIMITED_NODE_NAMES.join(" ")]: t.special(t.atom),
  "MathBracketOpen MathBracketClose MathParenOpen MathParenClose": t.processingInstruction,
  VerbatimBody: t.monospace,
  "{ }": t.brace,
});

// Layers a dark-appropriate style over basicSetup's light-background default; each element family gets its own vivid ink color.
const latexHighlightStyle = HighlightStyle.define([
  { tag: t.lineComment, color: "var(--ink-green)", fontStyle: "italic" },
  { tag: t.macroName, color: "var(--nonrepro)" },
  { tag: t.special(t.macroName), color: "var(--nonrepro)", fontWeight: "600" },
  { tag: t.heading, color: "var(--ink-orange)", fontWeight: "700" },
  { tag: t.link, color: "var(--ink-purple)" },
  { tag: t.keyword, color: "var(--ink-gold)", fontWeight: "600" },
  { tag: t.typeName, color: "var(--ink-gold)", fontStyle: "italic" },
  { tag: t.special(t.typeName), color: "var(--ink-brown)" },
  { tag: t.special(t.atom), color: "var(--ink-cyan)" },
  { tag: t.processingInstruction, color: "var(--ink-cyan)" },
  { tag: t.brace, color: "var(--type-mid)" },
  { tag: t.monospace, color: "var(--ink-brown)" },
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
