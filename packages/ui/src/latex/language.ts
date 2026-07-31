import { HighlightStyle, LRLanguage, LanguageSupport, syntaxHighlighting } from "@codemirror/language";
import { styleTags, tags as t } from "@lezer/highlight";
import { parser } from "./parser";

const highlighting = styleTags({
  Comment: t.lineComment,
  Command: t.macroName,
  // A variant of macroName, not a separate color -- same family as a bare command, but the
  // text-styling family (\textbf/\emph/...) reads visually distinct from e.g. \ref or a custom macro.
  TextCommand: t.special(t.macroName),
  SectionCommand: t.heading,
  RefCommand: t.link,
  "BeginKw EndKw": t.keyword,
  "EnvName MathEnvName": t.typeName,
  // A variant of typeName -- groups a verbatim environment's own name with its monospace body,
  // rather than with ordinary/math environment names.
  VerbatimEnvName: t.special(t.typeName),
  "InlineMath DisplayMathDollar DisplayMathBracket InlineMathParen": t.special(t.atom),
  "MathBracketOpen MathBracketClose MathParenOpen MathParenClose": t.processingInstruction,
  VerbatimBody: t.monospace,
  "{ }": t.brace,
});

// `basicSetup` already brings its own syntaxHighlighting(defaultHighlightStyle), whose colors
// assume a light background -- illegible against this app's dark editor theme. This layers a
// second, dark-appropriate style on top of it for the tags used above.
//
// Each element family gets its own ink color (tokens.css's --ink-* set) rather than sharing
// --type-hi/mid/lo the way the original, more minimal version of this file did -- comments,
// environments, headings, references, verbatim, and math now each read as a distinctly colored
// element instead of a variant of the same one or two accents. Deliberately vivid (One Dark/
// Dracula register) rather than a muted pastel variant of the base accent -- a first pass here
// used pastels too close in lightness to the surrounding text to actually read as distinct.
// --nonrepro (the app's signature blue) stays reserved for plain macros specifically.
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
