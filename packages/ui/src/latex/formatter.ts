import { Text } from "@codemirror/state";
import { latexLanguage } from "./language";

const INDENT_UNIT = "  ";
const ENV_NODE_NAMES = new Set(["Environment", "MathEnvironment", "VerbatimEnvironment"]);

interface EnvSpan {
  beginLine: number;
  endLine: number;
}

// Line-based, not a full tree re-serialization -- every line's content is left exactly as written; only indentation and blank-line context change.
export function formatLatex(source: string): string {
  // Split on "\n" only, not /\r?\n/, so this Text's offsets exactly match the raw `source` string the parser sees.
  const doc = Text.of(source.split("\n"));
  const tree = latexLanguage.parser.parse(source);

  const envSpans: EnvSpan[] = [];
  const verbatimLines = new Set<number>();

  tree.iterate({
    enter: (node) => {
      if (ENV_NODE_NAMES.has(node.name)) {
        envSpans.push({ beginLine: doc.lineAt(node.from).number, endLine: doc.lineAt(node.to).number });
      } else if (node.name === "VerbatimBody") {
        const fromLine = doc.lineAt(node.from).number;
        const toLine = doc.lineAt(node.to).number;
        for (let line = fromLine; line <= toLine; line++) verbatimLines.add(line);
      }
    },
  });

  // Depth per line via a delta sweep, O(lines + environments), rather than checking every span against every line.
  const depthDelta = new Array<number>(doc.lines + 2).fill(0);
  for (const span of envSpans) {
    depthDelta[span.beginLine + 1]++;
    depthDelta[span.endLine]--;
  }

  const outLines: string[] = [];
  let blankRun = 0;
  let depth = 0;

  for (let i = 1; i <= doc.lines; i++) {
    // depth equals how many environment spans strictly contain line i; \begin/\end lines themselves sit at the outer depth.
    depth += depthDelta[i];
    const rawLine = doc.line(i).text;

    // Verbatim/lstlisting/minted body content is opaque to this grammar; passed through byte-for-byte, even blank lines.
    if (verbatimLines.has(i)) {
      outLines.push(rawLine);
      blankRun = 0;
      continue;
    }

    const trimmed = rawLine.trim();
    if (trimmed === "") {
      blankRun++;
      if (blankRun <= 1) outLines.push(""); // collapse runs of 2+ blank lines to exactly one
      continue;
    }
    blankRun = 0;
    outLines.push(INDENT_UNIT.repeat(depth) + trimmed);
  }

  while (outLines.length > 0 && outLines[0] === "") outLines.shift();
  while (outLines.length > 0 && outLines[outLines.length - 1] === "") outLines.pop();

  const formatted = outLines.join("\n") + "\n";
  return formatted === source ? source : formatted;
}
