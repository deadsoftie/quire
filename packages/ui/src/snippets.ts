import { snippetCompletion } from "@codemirror/autocomplete";
import type { Completion, CompletionContext, CompletionResult } from "@codemirror/autocomplete";

// Task 3.7's fixed abbreviation set (QUIRE_SPEC.md Section 8, M3). These are mnemonic shorthands,
// not LaTeX command names, so they trigger on a bare word rather than coreCompletionSource's
// backslash-anchored contexts in Editor.tsx -- `fig` expands, `\fig` does not exist as LaTeX.
// `${1:...}` templates reuse the exact tabstop syntax CompletionItem.insert already carries over
// the wire (Section 6), which CM6's own `snippet()`/`snippetCompletion()` parse directly -- no
// hand-rolled tabstop navigation. Repeating a field number (`beg`'s `${1:environment}` on both
// lines) mirrors that field between both instances as the user types, for free.
const SNIPPETS: { trigger: string; detail: string; template: string }[] = [
  {
    trigger: "fig",
    detail: "figure environment",
    template:
      "\\begin{figure}[${1:htbp}]\n\t\\centering\n\t\\includegraphics[width=${2:0.8}\\linewidth]{${3:path}}\n\t\\caption{${4:caption}}\n\t\\label{fig:${5:label}}\n\\end{figure}",
  },
  {
    trigger: "tab",
    detail: "table environment",
    template:
      "\\begin{table}[${1:htbp}]\n\t\\centering\n\t\\caption{${2:caption}}\n\t\\label{tab:${3:label}}\n\t\\begin{tabular}{${4:c}}\n\t\t${5:cell}\n\t\\end{tabular}\n\\end{table}",
  },
  {
    trigger: "eq",
    detail: "equation environment",
    template: "\\begin{equation}\n\t${1:equation}\n\t\\label{eq:${2:label}}\n\\end{equation}",
  },
  {
    trigger: "itm",
    detail: "itemize environment",
    template: "\\begin{itemize}\n\t\\item ${1:item}\n\\end{itemize}",
  },
  {
    trigger: "sec",
    detail: "section heading",
    template: "\\section{${1:title}}",
  },
  {
    trigger: "beg",
    detail: "begin/end pair",
    template: "\\begin{${1:environment}}\n\t${2}\n\\end{${1:environment}}",
  },
];

const OPTIONS: Completion[] = SNIPPETS.map((s) =>
  snippetCompletion(s.template, { label: s.trigger, detail: s.detail }),
);

// Local and synchronous -- no quire-sidecar round trip, unlike coreCompletionSource's index-backed
// sources. Rejected right after a backslash so it doesn't double up with bare-command macro/CTAN
// completion there (typing "\sec" should offer \section-the-command, not the "sec" snippet).
export function snippetCompletionSource(context: CompletionContext): CompletionResult | null {
  const word = context.matchBefore(/[a-zA-Z]+/);
  if (!word || (word.from === word.to && !context.explicit)) return null;
  if (context.state.sliceDoc(Math.max(0, word.from - 1), word.from) === "\\") return null;

  const options = OPTIONS.filter((o) => (o.label as string).startsWith(word.text));
  if (options.length === 0) return null;

  return { from: word.from, options, validFor: /^[a-zA-Z]*$/ };
}
