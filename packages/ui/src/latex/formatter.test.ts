import { describe, expect, it } from "vitest";
import { formatLatex } from "./formatter";

describe("formatLatex", () => {
  it("indents an environment's content one level, but not the \\begin/\\end lines themselves", () => {
    const source = "\\begin{itemize}\n\\item one\n\\item two\n\\end{itemize}\n";
    expect(formatLatex(source)).toBe("\\begin{itemize}\n  \\item one\n  \\item two\n\\end{itemize}\n");
  });

  it("stacks indentation for nested environments", () => {
    const source = "\\begin{figure}\n\\begin{itemize}\n\\item nested\n\\end{itemize}\n\\end{figure}\n";
    expect(formatLatex(source)).toBe(
      "\\begin{figure}\n  \\begin{itemize}\n    \\item nested\n  \\end{itemize}\n\\end{figure}\n",
    );
  });

  it("indents math environment content the same way as any other environment", () => {
    const source = "\\begin{align}\nx &= y \\\\\ny &= z\n\\end{align}\n";
    expect(formatLatex(source)).toBe("\\begin{align}\n  x &= y \\\\\n  y &= z\n\\end{align}\n");
  });

  it("fixes existing wrong indentation rather than just preserving it", () => {
    const source = "\\begin{itemize}\n      \\item over-indented\n\\end{itemize}\n";
    expect(formatLatex(source)).toBe("\\begin{itemize}\n  \\item over-indented\n\\end{itemize}\n");
  });

  it("leaves verbatim/lstlisting/minted body content completely untouched, even if it looks misindented", () => {
    const source = "\\begin{verbatim}\nint main() {\n    return 0;\n}\n\\end{verbatim}\n";
    // The body must survive byte-for-byte - only the \begin/\end lines are subject to normal formatting.
    expect(formatLatex(source)).toBe(source);
  });

  it("collapses a run of blank lines to exactly one", () => {
    const source = "para one\n\n\n\npara two\n";
    expect(formatLatex(source)).toBe("para one\n\npara two\n");
  });

  it("preserves a single blank line as a paragraph break", () => {
    const source = "para one\n\npara two\n";
    expect(formatLatex(source)).toBe(source);
  });

  it("strips trailing whitespace from ordinary lines", () => {
    const source = "\\section{Title}   \nSome text.\t\n";
    expect(formatLatex(source)).toBe("\\section{Title}\nSome text.\n");
  });

  it("trims leading and trailing blank lines from the whole document", () => {
    const source = "\n\n\\documentclass{article}\ncontent\n\n\n";
    expect(formatLatex(source)).toBe("\\documentclass{article}\ncontent\n");
  });

  it("is idempotent: formatting already-formatted output changes nothing", () => {
    const source = "\\begin{itemize}\n\\item one\n\\end{itemize}\n";
    const once = formatLatex(source);
    expect(formatLatex(once)).toBe(once);
  });

  it("returns the identical string reference when nothing changes", () => {
    const source = "\\begin{itemize}\n  \\item already formatted\n\\end{itemize}\n";
    expect(formatLatex(source)).toBe(source);
  });
});
