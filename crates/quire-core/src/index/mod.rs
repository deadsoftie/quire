//! The completion/outline index (Section 9.4). Built fresh from a [`crate::project::FileGraph`]
//! on every call -- no server-side cache, matching the rest of `quire-core` (per
//! `docs/CONTRACT.md`, every RPC handler re-derives what it needs from `projectId` directly).
//! Real incremental reindexing (reparsing only a changed file) is task 3.6; this module's job is
//! to shape the data so that's a cache-invalidation problem later, not a rewrite.
//!
//! 3.1 extracts `\label` definitions and section structure (`\part`.."\subsubsection") -- both in
//! the same pass over a file, since they're the same walk. 3.2-3.5 extend [`ProjectIndex`] with
//! their own extraction sources (bibliography, macros, file paths, CTAN commands) rather than
//! standing up parallel machinery.

use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

use crate::project::{FileGraph, FileKind};
use crate::rpc::{OutlineNode, OutlineNodeKind, Position};

/// A `\label{name}` definition site, flattened across every file in the project -- what
/// `\ref`/`\eqref`/`\autoref` completion (Section 9.4's ranking: project-local outranks
/// everything else) draws from.
#[derive(Debug, Clone)]
pub struct LabelDef {
    pub name: String,
    pub uri: PathBuf,
    pub position: Position,
}

struct FileIndex {
    /// Top-level outline tree for this one file -- `outline()` is per-`uri`, not project-wide.
    outline: Vec<OutlineNode>,
    /// This file's own `\label` sites, flattened out of `outline`'s tree shape for project-wide merging.
    labels: Vec<LabelDef>,
}

pub struct ProjectIndex {
    files: HashMap<PathBuf, FileIndex>,
}

impl ProjectIndex {
    /// Reads and parses every `.tex` file reachable in `graph`. A file that's disappeared since
    /// the graph was built (race with an external edit) is silently skipped -- same "record what
    /// you can, don't fail the whole request over one file" posture `build_file_graph` itself takes.
    pub fn build(graph: &FileGraph) -> Self {
        let mut files = HashMap::with_capacity(graph.files.len());
        for file in &graph.files {
            if file.kind != FileKind::Tex {
                continue;
            }
            let Ok(content) = fs::read_to_string(&file.path) else {
                continue;
            };
            files.insert(file.path.clone(), index_file(&content, &file.path));
        }
        ProjectIndex { files }
    }

    /// `outline()`'s real implementation: just this one file's section tree, `[]` if it isn't
    /// part of the graph at all (matches the frozen stub's "always an array" shape).
    pub fn outline_for(&self, uri: &Path) -> Vec<OutlineNode> {
        self.files.get(uri).map(|f| f.outline.clone()).unwrap_or_default()
    }

    /// Every `\label` in the project, from every file -- the whole point of building a
    /// project-level merged view instead of one file at a time.
    pub fn labels(&self) -> impl Iterator<Item = &LabelDef> {
        self.files.values().flat_map(|f| f.labels.iter())
    }
}

fn index_file(content: &str, uri: &Path) -> FileIndex {
    let stripped = crate::project::strip_comments(content);
    let mut entries = Vec::new();
    scan_into(&stripped, &mut entries);

    let labels = entries
        .iter()
        .filter(|e| e.kind == OutlineNodeKind::Label)
        .map(|e| LabelDef { name: e.text.clone(), uri: uri.to_path_buf(), position: e.position })
        .collect();

    let outline = build_outline(entries);

    FileIndex { outline, labels }
}

struct RawEntry {
    kind: OutlineNodeKind,
    text: String,
    position: Position,
}

fn heading_rank(kind: OutlineNodeKind) -> Option<u8> {
    Some(match kind {
        OutlineNodeKind::Part => 0,
        OutlineNodeKind::Chapter => 1,
        OutlineNodeKind::Section => 2,
        OutlineNodeKind::Subsection => 3,
        OutlineNodeKind::Subsubsection => 4,
        OutlineNodeKind::Label => return None,
    })
}

/// Longest-name-first, same discipline `project::parse_references` already applies to
/// `\includegraphics`/`\include` -- avoids a prefix collision biting later even where none
/// exists among these particular names today.
fn classify(rest: &str) -> Option<(OutlineNodeKind, usize)> {
    const COMMANDS: &[(&str, OutlineNodeKind)] = &[
        ("\\subsubsection", OutlineNodeKind::Subsubsection),
        ("\\subsection", OutlineNodeKind::Subsection),
        ("\\section", OutlineNodeKind::Section),
        ("\\chapter", OutlineNodeKind::Chapter),
        ("\\part", OutlineNodeKind::Part),
        ("\\label", OutlineNodeKind::Label),
    ];
    COMMANDS.iter().find(|(name, _)| rest.starts_with(name)).map(|(name, kind)| (*kind, name.len()))
}

/// Scans `stripped` (already comment-free) for section/label commands, in document order.
/// Deliberately doesn't skip past a heading's `{...}` argument after extracting its title text --
/// it continues scanning *into* the argument instead, so a `\label{}` nested inside (e.g.
/// `\section{Intro\label{sec:intro}}`, a common pattern) is still found in its natural document
/// position, with no separate recursion/position-remapping needed.
fn scan_into(stripped: &str, entries: &mut Vec<RawEntry>) {
    let bytes = stripped.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] != b'\\' {
            i += 1;
            continue;
        }

        let Some((kind, name_len)) = classify(&stripped[i..]) else {
            i += 1;
            continue;
        };

        let mut after = i + name_len;
        if bytes.get(after) == Some(&b'*') {
            after += 1;
        }
        if bytes.get(after) != Some(&b'{') {
            i += name_len;
            continue;
        }
        let Some(close) = matching_brace(stripped, after) else {
            i += name_len;
            continue;
        };

        let position = position_at(stripped, i);
        let raw_arg = &stripped[after + 1..close];

        if kind == OutlineNodeKind::Label {
            entries.push(RawEntry { kind, text: raw_arg.trim().to_string(), position });
            i = close + 1;
        } else {
            // A nested \label{} (if any) must not show up literally in the displayed title.
            let title = strip_label_commands(raw_arg).trim().to_string();
            entries.push(RawEntry { kind, text: title, position });
            i = after + 1; // into the argument, not past it -- see doc comment above
        }
    }
}

/// Byte offset of `{`'s matching `}`, honoring nesting (so `\section{A \textbf{bold} word}`
/// doesn't truncate at `\textbf`'s own closing brace) and `\{`/`\}` escapes. Char-based (not raw
/// byte indexing) so skipping an escaped character can't land mid multi-byte UTF-8 sequence and
/// produce an invalid slice index later.
fn matching_brace(s: &str, open_byte: usize) -> Option<usize> {
    let mut depth = 0i32;
    let mut chars = s[open_byte..].char_indices();
    while let Some((rel, c)) = chars.next() {
        match c {
            '\\' => {
                chars.next();
            }
            '{' => depth += 1,
            '}' => {
                depth -= 1;
                if depth == 0 {
                    return Some(open_byte + rel);
                }
            }
            _ => {}
        }
    }
    None
}

/// Removes any `\label{...}` spans from `text` (a heading's raw argument text) so a nested label
/// doesn't show up literally in the outline's displayed title. Every other embedded command
/// (`\textbf{}`, `\emph{}`, ...) is left as-is -- rendering LaTeX markup to plain text is out of
/// scope here, only `\label` is a semantic annotation nobody wants to see spelled out.
fn strip_label_commands(text: &str) -> String {
    let bytes = text.as_bytes();
    let mut spans = Vec::new();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'\\' && text[i..].starts_with("\\label") {
            let after = i + "\\label".len();
            if bytes.get(after) == Some(&b'{') {
                if let Some(close) = matching_brace(text, after) {
                    spans.push((i, close + 1));
                    i = close + 1;
                    continue;
                }
            }
        }
        i += 1;
    }

    if spans.is_empty() {
        return text.to_string();
    }

    let mut out = String::with_capacity(text.len());
    let mut cursor = 0;
    for (start, end) in spans {
        out.push_str(&text[cursor..start]);
        cursor = end;
    }
    out.push_str(&text[cursor..]);
    out
}

/// Byte offset -> `Position` (0-based line, 0-based UTF-16 code units per Section 6's Position --
/// matches CodeMirror/LSP convention). O(n) per call, fine here: called a handful of times per
/// file (once per label/heading), never in a hot loop.
fn position_at(content: &str, byte_offset: usize) -> Position {
    let mut line = 0u32;
    let mut line_start = 0usize;
    for (i, b) in content.as_bytes()[..byte_offset].iter().enumerate() {
        if *b == b'\n' {
            line += 1;
            line_start = i + 1;
        }
    }
    let column = content[line_start..byte_offset].encode_utf16().count() as u32;
    Position { line, column }
}

/// Inverse of [`position_at`]: `Position` -> byte offset into `text`. Out-of-range lines/columns
/// clamp to the nearest valid offset (end of line / end of document) rather than panicking --
/// the caller supplies whatever the editor's own cursor position happens to be.
fn byte_offset_of(text: &str, position: &Position) -> usize {
    let mut offset = 0usize;
    for (line_no, line) in text.split('\n').enumerate() {
        if line_no as u32 == position.line {
            let mut utf16_count = 0u32;
            for (byte_idx, ch) in line.char_indices() {
                if utf16_count >= position.column {
                    return offset + byte_idx;
                }
                utf16_count += ch.len_utf16() as u32;
            }
            return offset + line.len();
        }
        offset += line.len() + 1; // +1 for the '\n' this split consumed
    }
    text.len()
}

/// Turns the flat, document-order `entries` (headings and `\label` leaves) into a nested tree by
/// heading rank -- classic "flat heading list to table of contents" shape. A `\label` never opens
/// a new nesting level; it always attaches as a leaf under whichever heading is currently
/// innermost-open (or top-level, before any heading at all).
fn build_outline(entries: Vec<RawEntry>) -> Vec<OutlineNode> {
    let mut stack: Vec<OutlineNode> = Vec::new();
    let mut top: Vec<OutlineNode> = Vec::new();

    for entry in entries {
        match heading_rank(entry.kind) {
            Some(rank) => {
                while let Some(last) = stack.last() {
                    if heading_rank(last.kind).expect("stack only ever holds headings") >= rank {
                        let finished = stack.pop().expect("just checked via .last()");
                        attach(&mut stack, &mut top, finished);
                    } else {
                        break;
                    }
                }
                stack.push(OutlineNode { label: entry.text, kind: entry.kind, position: entry.position, children: Vec::new() });
            }
            None => {
                let leaf = OutlineNode { label: entry.text, kind: entry.kind, position: entry.position, children: Vec::new() };
                attach(&mut stack, &mut top, leaf);
            }
        }
    }

    while let Some(finished) = stack.pop() {
        attach(&mut stack, &mut top, finished);
    }

    top
}

fn attach(stack: &mut [OutlineNode], top: &mut Vec<OutlineNode>, node: OutlineNode) {
    match stack.last_mut() {
        Some(parent) => parent.children.push(node),
        None => top.push(node),
    }
}

/// Whether `position` in `text` sits inside an unclosed `\ref{`/`\eqref{`/`\autoref{` argument --
/// the trigger context for label completion (Section 9.4's `\ref`/`\eqref`/`\autoref` sites).
/// Scans backward from the cursor tracking brace depth; stops at the first line break, since a
/// label reference's argument is never expected to span multiple lines.
pub fn is_ref_completion_context(text: &str, position: &Position) -> bool {
    let cursor = byte_offset_of(text, position).min(text.len());
    let before = &text[..cursor];
    let bytes = before.as_bytes();
    let mut depth = 0i32;
    let mut i = before.len();
    while i > 0 {
        i -= 1;
        match bytes[i] {
            b'\n' => return false,
            b'}' => depth += 1,
            b'{' => {
                if depth == 0 {
                    let prefix = &before[..i];
                    return prefix.ends_with("\\ref") || prefix.ends_with("\\eqref") || prefix.ends_with("\\autoref");
                }
                depth -= 1;
            }
            _ => {}
        }
    }
    false
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn position_at_counts_utf16_units_not_bytes() {
        // "café" -- 'é' is 2 bytes in UTF-8 but 1 UTF-16 code unit; a 4-byte emoji is 2 UTF-16
        // units (a surrogate pair). Both must be counted the CodeMirror/LSP way, not by byte.
        let content = "café \u{1F600} x";
        let x_byte = content.rfind('x').unwrap();
        let pos = position_at(content, x_byte);
        assert_eq!(pos, Position { line: 0, column: "café \u{1F600} ".encode_utf16().count() as u32 });
    }

    #[test]
    fn byte_offset_of_is_the_inverse_of_position_at() {
        let content = "line one\nsecond café line\nthird";
        // Only real char boundaries -- scan_into only ever calls position_at at a `\` byte,
        // always a boundary; position_at itself isn't meant to tolerate arbitrary offsets.
        for byte in [0, 5, 9, content.len()] {
            let pos = position_at(content, byte);
            assert_eq!(byte_offset_of(content, &pos), byte, "byte {byte} -> {pos:?} -> back");
        }
    }

    #[test]
    fn extracts_labels_and_nested_section_structure() {
        let content = "\\section{Intro}\n\\label{sec:intro}\n\\subsection{Background}\n\\label{sec:bg}\n\\section{Conclusion}\n";
        let index = index_file(content, Path::new("main.tex"));

        assert_eq!(index.labels.iter().map(|l| l.name.as_str()).collect::<Vec<_>>(), vec!["sec:intro", "sec:bg"]);

        assert_eq!(index.outline.len(), 2, "two top-level sections: {:?}", index.outline);
        let intro = &index.outline[0];
        assert_eq!(intro.label, "Intro");
        assert_eq!(intro.kind, OutlineNodeKind::Section);
        // \label then \subsection, both children of Intro until Conclusion closes it.
        assert_eq!(intro.children.len(), 2);
        assert_eq!(intro.children[0].kind, OutlineNodeKind::Label);
        assert_eq!(intro.children[0].label, "sec:intro");
        assert_eq!(intro.children[1].kind, OutlineNodeKind::Subsection);
        assert_eq!(intro.children[1].label, "Background");
        assert_eq!(intro.children[1].children.len(), 1);
        assert_eq!(intro.children[1].children[0].label, "sec:bg");

        assert_eq!(index.outline[1].label, "Conclusion");
        assert!(index.outline[1].children.is_empty());
    }

    #[test]
    fn label_nested_inside_a_heading_argument_is_found_and_stripped_from_the_title() {
        let content = "\\section{Intro\\label{sec:intro}}\nBody text.\n";
        let index = index_file(content, Path::new("main.tex"));

        assert_eq!(index.labels.len(), 1);
        assert_eq!(index.labels[0].name, "sec:intro");

        assert_eq!(index.outline.len(), 1);
        assert_eq!(index.outline[0].label, "Intro", "the nested \\label must not appear in the title");
        assert_eq!(index.outline[0].children.len(), 1);
        assert_eq!(index.outline[0].children[0].kind, OutlineNodeKind::Label);
    }

    #[test]
    fn label_before_any_heading_is_top_level() {
        let content = "\\label{top}\n\\section{First}\n";
        let index = index_file(content, Path::new("main.tex"));
        assert_eq!(index.outline.len(), 2);
        assert_eq!(index.outline[0].kind, OutlineNodeKind::Label);
        assert_eq!(index.outline[1].kind, OutlineNodeKind::Section);
    }

    #[test]
    fn commented_out_label_is_not_indexed() {
        let content = "% \\label{ignored}\n\\section{Real}\n\\label{real}\n";
        let index = index_file(content, Path::new("main.tex"));
        assert_eq!(index.labels.iter().map(|l| l.name.as_str()).collect::<Vec<_>>(), vec!["real"]);
    }

    #[test]
    fn ref_context_detects_ref_eqref_autoref_but_not_other_commands() {
        let pos = |text: &str| -> Position {
            let line = text.matches('\n').count() as u32;
            let col_start = text.rfind('\n').map(|i| i + 1).unwrap_or(0);
            Position { line, column: text[col_start..].encode_utf16().count() as u32 }
        };

        for cmd in ["\\ref{", "\\eqref{", "\\autoref{", "\\ref{sec:in"] {
            assert!(is_ref_completion_context(cmd, &pos(cmd)), "{cmd:?} should be a ref context");
        }
        for text in ["\\cite{", "\\textbf{", "\\ref{done} ", "no braces at all", "\\myref{"] {
            assert!(!is_ref_completion_context(text, &pos(text)), "{text:?} should not be a ref context");
        }
    }

    #[test]
    fn ref_context_does_not_cross_line_boundaries() {
        let text = "\\ref{\nsec:x";
        let pos = Position { line: 1, column: 4 };
        assert!(!is_ref_completion_context(text, &pos));
    }
}
