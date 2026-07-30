//! The completion/outline index (Section 9.4). Built fresh from a [`crate::project::FileGraph`]
//! on every call -- no server-side cache, matching the rest of `quire-core` (per
//! `docs/CONTRACT.md`, every RPC handler re-derives what it needs from `projectId` directly).
//!
//! 3.1 extracts `\label` definitions and section structure (`\part`.."\subsubsection") -- both in
//! the same pass over a file, since they're the same walk. 3.2 adds `.bib` parsing, discovered via
//! `\bibliography`/`\addbibresource` in `.tex` source (there's no `Bib` `FileKind` in
//! [`crate::project::FileGraph`] -- bibliography files aren't mirrored into the compile shadow
//! dir today, a separate, pre-existing gap this task doesn't touch). 3.3 adds `\newcommand`/`\def`/
//! `\DeclareMathOperator` macros, and -- since something in 3.1-3.3 has to build it before 3.5
//! needs it -- `\usepackage` tracking, which isn't a numbered task of its own. 3.4 adds file-path
//! completion. 3.5 ([`ctan`]) is the one extension source that isn't parsed from project source at
//! all -- a bundled command database scoped by [`ProjectIndex::packages`].
//!
//! **3.6 ("incremental reindex") turned out not to need a cache.** The plan through 3.5 (see this
//! comment's own earlier revisions) was "reparse only a changed file," anticipating a persistent
//! per-file cache the way `rerun.rs` persists citation fingerprints/page hashes across compiles.
//! But `quire-sidecar` spawns a *fresh OS process per RPC call* (`docs/CONTRACT.md`,
//! `packages/client/src/sidecarProcess.ts`'s `runOnce`) -- there is no long-lived process for
//! `complete`/`outline` to hold an in-memory cache in at all, the same constraint `rerun.rs`
//! solves by persisting to disk. Before building that same disk-cache machinery here (real
//! complexity: serialization, mtime/size invalidation, concurrent-process write races), task
//! 3.6's actual acceptance criterion -- "≤10ms for a single-file change" on a 50-file thesis --
//! got measured against the honest full-rebuild-every-call approach first
//! (`tests/reindex_bench.rs`). It measured ~2ms (release) / ~5ms (debug) on a real 51-file, ~1000
//! line fixture -- comfortably under budget without a cache, so one wasn't built. The one real
//! inefficiency found along the way (`find_path_candidates` walking the project directory twice,
//! once per extension bucket) was fixed directly: one walk, two result buckets.

pub mod ctan;
pub mod symbols;

use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};

use crate::project::{self, FileGraph, FileKind};
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

/// A citation key from a `.bib` entry, merged project-wide the same way [`LabelDef`] is.
/// `@comment`/`@string`/`@preamble` entries are never citable, so they never produce one of these.
#[derive(Debug, Clone)]
pub struct CitationEntry {
    pub key: String,
    /// "Author, *Title*, Year" per Section 9.4, literally -- `*...*` included, not rendered here.
    /// Whichever of the three fields the entry is missing is just omitted, not left as a dangling
    /// separator; `None` only when the entry has none of author/title/year at all.
    pub detail: Option<String>,
}

/// A `\newcommand`/`\def`/`\DeclareMathOperator` definition, merged project-wide the same way
/// [`LabelDef`] is (no textual/definition-order scoping -- consistent with how labels and
/// citations already work here, not a new model just for macros).
#[derive(Debug, Clone)]
pub struct MacroDef {
    /// Without the leading backslash, matching [`LabelDef::name`]/[`CitationEntry::key`]'s convention.
    pub name: String,
    /// How many required `{}` arguments -- what turns into `insert`'s `${1:...}` tabstops.
    pub arity: u32,
    /// Raw substitution body, trimmed. Not used for `insert` (that's arity-driven, not
    /// body-driven), just a readable `detail` so the popup shows what the macro actually expands to.
    pub body: String,
}

struct FileIndex {
    /// Top-level outline tree for this one file -- `outline()` is per-`uri`, not project-wide.
    outline: Vec<OutlineNode>,
    /// This file's own `\label` sites, flattened out of `outline`'s tree shape for project-wide merging.
    labels: Vec<LabelDef>,
    /// `.bib` files this one file's `\bibliography`/`\addbibresource` commands resolved to.
    bib_resources: Vec<PathBuf>,
    /// This file's own macro definitions.
    macros: Vec<MacroDef>,
    /// This file's own `\usepackage{...}` loads.
    packages: Vec<String>,
}

pub struct ProjectIndex {
    files: HashMap<PathBuf, FileIndex>,
    citations: Vec<CitationEntry>,
    macros: Vec<MacroDef>,
    packages: HashSet<String>,
    /// Project-relative, forward-slash paths for every real `.tex` file under the project
    /// directory -- the `\input`/`\include` completion candidate set (task 3.4).
    tex_paths: Vec<String>,
    /// Same, but every file matching [`project::GRAPHIC_EXTENSIONS`] -- the `\includegraphics`
    /// completion candidate set.
    graphic_paths: Vec<String>,
}

impl ProjectIndex {
    /// Reads and parses every `.tex` file reachable in `graph`, then every `.bib` file any of them
    /// referenced. A file that's disappeared since the graph was built (race with an external
    /// edit) is silently skipped -- same "record what you can, don't fail the whole request over
    /// one file" posture `build_file_graph` itself takes.
    pub fn build(graph: &FileGraph) -> Self {
        // Same convention `build_file_graph` itself uses for \input/\includegraphics: relative
        // paths resolve against the root document's directory, not each referencing file's own.
        let base_dir = graph.root.parent().unwrap_or_else(|| Path::new("."));

        let mut files = HashMap::with_capacity(graph.files.len());
        let mut bib_paths: HashSet<PathBuf> = HashSet::new();
        // Keyed by name so a macro defined more than once (redefinition, or the same name
        // appearing in two files) shows up once in completion rather than as confusing duplicates;
        // last one scanned wins, since there's no real cross-file definition-order to prefer by.
        let mut macros: HashMap<String, MacroDef> = HashMap::new();
        let mut packages: HashSet<String> = HashSet::new();

        for file in &graph.files {
            if file.kind != FileKind::Tex {
                continue;
            }
            let Ok(content) = fs::read_to_string(&file.path) else {
                continue;
            };
            let index = index_file(&content, &file.path, base_dir);
            bib_paths.extend(index.bib_resources.iter().cloned());
            packages.extend(index.packages.iter().cloned());
            for m in index.macros.iter().cloned() {
                macros.insert(m.name.clone(), m);
            }
            files.insert(file.path.clone(), index);
        }

        let mut citations: Vec<CitationEntry> = bib_paths
            .iter()
            .filter_map(|p| fs::read_to_string(p).ok())
            .flat_map(|content| parse_bib(&content).into_iter().map(citation_entry).collect::<Vec<_>>())
            .collect();
        citations.sort_by(|a, b| a.key.cmp(&b.key));

        let mut macros: Vec<MacroDef> = macros.into_values().collect();
        macros.sort_by(|a, b| a.name.cmp(&b.name));

        // Unlike everything above, these come from a filesystem walk, not FileGraph -- the whole
        // point is offering files *not yet* \input/\includegraphics'd, which FileGraph (only
        // what's already referenced) can't provide. One walk collecting both, not two.
        let (tex_paths, graphic_paths) = find_path_candidates(base_dir);

        ProjectIndex { files, citations, macros, packages, tex_paths, graphic_paths }
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

    /// Every citable entry from every `.bib` file any project `.tex` file references.
    pub fn citations(&self) -> impl Iterator<Item = &CitationEntry> {
        self.citations.iter()
    }

    /// Every user-defined macro in the project, deduplicated by name.
    pub fn macros(&self) -> impl Iterator<Item = &MacroDef> {
        self.macros.iter()
    }

    /// Every package loaded anywhere in the project via `\usepackage`. Not consumed by anything
    /// yet -- 3.5's CTAN command scoping is the reason this exists ("only suggest what's actually
    /// available," Section 9.4).
    pub fn packages(&self) -> impl Iterator<Item = &str> {
        self.packages.iter().map(|s| s.as_str())
    }

    /// `\input`/`\include` path completion candidates -- every `.tex` file in the project, as a
    /// project-relative path.
    pub fn tex_paths(&self) -> impl Iterator<Item = &str> {
        self.tex_paths.iter().map(|s| s.as_str())
    }

    /// `\includegraphics` path completion candidates -- every image file in the project.
    pub fn graphic_paths(&self) -> impl Iterator<Item = &str> {
        self.graphic_paths.iter().map(|s| s.as_str())
    }
}

fn index_file(content: &str, uri: &Path, base_dir: &Path) -> FileIndex {
    let stripped = crate::project::strip_comments(content);
    let mut entries = Vec::new();
    scan_into(&stripped, &mut entries);

    let labels = entries
        .iter()
        .filter(|e| e.kind == OutlineNodeKind::Label)
        .map(|e| LabelDef { name: e.text.clone(), uri: uri.to_path_buf(), position: e.position })
        .collect();

    let outline = build_outline(entries);
    let bib_resources = find_bib_resources(&stripped, base_dir);
    let macros = find_macros(&stripped);
    let packages = find_packages(&stripped);

    FileIndex { outline, labels, bib_resources, macros, packages }
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

/// Resolves a `\bibliography{name1,name2}` (classic BibTeX, comma-separated, no extension) or
/// `\addbibresource{name.bib}` (biblatex, one file, extension usually already given) argument to
/// real `.bib` files, confined to the project directory via [`project::resolve_within`] the same
/// way `\input`/`\includegraphics` targets are -- see that function's own doc comment for why.
fn find_bib_resources(stripped: &str, base_dir: &Path) -> Vec<PathBuf> {
    let mut found = Vec::new();
    let bytes = stripped.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] != b'\\' {
            i += 1;
            continue;
        }
        let rest = &stripped[i..];
        // \bibliographystyle{...} would otherwise false-match \bibliography's prefix; the
        // "next char after the name must be `{`" check below already rejects it (name_len stops
        // right at "style{...}", which doesn't start with `{`), same disambiguation `classify`
        // relies on for e.g. \label vs. \labelformat.
        let (is_multi, name_len) = if rest.starts_with("\\bibliography") {
            (true, "\\bibliography".len())
        } else if rest.starts_with("\\addbibresource") {
            (false, "\\addbibresource".len())
        } else {
            i += 1;
            continue;
        };

        let after = i + name_len;
        if bytes.get(after) != Some(&b'{') {
            i += name_len;
            continue;
        }
        let Some(close) = matching_brace(stripped, after) else {
            i += name_len;
            continue;
        };
        let raw_arg = &stripped[after + 1..close];

        if is_multi {
            for name in raw_arg.split(',') {
                found.extend(resolve_bib(name.trim(), base_dir));
            }
        } else {
            found.extend(resolve_bib(raw_arg.trim(), base_dir));
        }

        i = close + 1;
    }
    found
}

fn resolve_bib(raw: &str, base_dir: &Path) -> Option<PathBuf> {
    let candidate = base_dir.join(raw);
    if let Some(resolved) = project::resolve_within(base_dir, candidate.clone()) {
        return Some(resolved);
    }
    if candidate.extension().is_none() {
        let with_ext = base_dir.join(format!("{raw}.bib"));
        return project::resolve_within(base_dir, with_ext);
    }
    None
}

struct BibEntry {
    key: String,
    author: Option<String>,
    title: Option<String>,
    year: Option<String>,
}

/// Parses every `@type{key, field = value, ...}` entry in a `.bib` file. `@comment`/`@string`/
/// `@preamble` are real BibTeX directives, never citable entries, so they're filtered out here
/// rather than left for the caller to remember to exclude.
fn parse_bib(content: &str) -> Vec<BibEntry> {
    let mut entries = Vec::new();
    let bytes = content.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] != b'@' {
            i += 1;
            continue;
        }
        let rest = &content[i + 1..];
        let type_len = rest.find(['{', '(']).unwrap_or(rest.len());
        let entry_type = rest[..type_len].trim().to_lowercase();
        if entry_type.is_empty() {
            i += 1;
            continue;
        }

        let after_type = i + 1 + type_len;
        if bytes.get(after_type) != Some(&b'{') {
            // Parenthesized `@type(...)` entries are rare/legacy BibTeX and unsupported here.
            i = (after_type + 1).max(i + 1);
            continue;
        }
        let Some(close) = matching_brace(content, after_type) else {
            i = after_type + 1;
            continue;
        };

        if !matches!(entry_type.as_str(), "comment" | "string" | "preamble") {
            if let Some(entry) = parse_bib_body(&content[after_type + 1..close]) {
                entries.push(entry);
            }
        }
        i = close + 1;
    }
    entries
}

/// `body` is everything between an entry's outer `{}` -- `"key, field = {value}, field2 = value2"`.
fn parse_bib_body(body: &str) -> Option<BibEntry> {
    let mut fields = split_top_level(body, ',').into_iter();
    let key = fields.next()?.trim().to_string();
    if key.is_empty() {
        return None;
    }

    let mut author = None;
    let mut title = None;
    let mut year = None;

    for field in fields {
        let Some(eq) = find_top_level_eq(field) else { continue };
        let name = field[..eq].trim().to_lowercase();
        let value = unwrap_bib_value(field[eq + 1..].trim());
        match name.as_str() {
            "author" => author = Some(value),
            "title" => title = Some(value),
            "year" => year = Some(value),
            _ => {}
        }
    }

    Some(BibEntry { key, author, title, year })
}

/// Splits on `sep` only at brace/quote depth 0 -- a BibTeX field value routinely contains commas
/// itself (`author = {Smith, John}`, the "Last, First" convention), so a naive `str::split(',')`
/// would cut a single field into two and misparse the entry.
fn split_top_level(body: &str, sep: char) -> Vec<&str> {
    let mut parts = Vec::new();
    let mut depth = 0i32;
    let mut in_quotes = false;
    let mut start = 0usize;
    for (i, c) in body.char_indices() {
        match c {
            '{' if !in_quotes => depth += 1,
            '}' if !in_quotes => depth -= 1,
            '"' if depth == 0 => in_quotes = !in_quotes,
            c if c == sep && depth == 0 && !in_quotes => {
                parts.push(&body[start..i]);
                start = i + c.len_utf8();
            }
            _ => {}
        }
    }
    parts.push(&body[start..]);
    parts
}

fn find_top_level_eq(field: &str) -> Option<usize> {
    let mut depth = 0i32;
    for (i, c) in field.char_indices() {
        match c {
            '{' => depth += 1,
            '}' => depth -= 1,
            '=' if depth == 0 => return Some(i),
            _ => {}
        }
    }
    None
}

/// Strips a field value's outer `{...}`/`"..."` wrapper (or leaves a bare value, e.g. `year =
/// 1984`, untouched), then strips any remaining brace characters entirely -- BibTeX's
/// case-protection braces (`title = {The {TeX}book}`) are a typesetting artifact real bibliography
/// styles never show literally, so a "readable" completion detail shouldn't either.
fn unwrap_bib_value(raw: &str) -> String {
    let trimmed = raw.trim();
    let unwrapped = trimmed
        .strip_prefix('{')
        .and_then(|s| s.strip_suffix('}'))
        .or_else(|| trimmed.strip_prefix('"').and_then(|s| s.strip_suffix('"')))
        .unwrap_or(trimmed);
    unwrapped.chars().filter(|&c| c != '{' && c != '}').collect::<String>().trim().to_string()
}

/// "Author, *Title*, Year" per Section 9.4, literally -- omits whichever field is missing rather
/// than leaving a dangling separator.
fn citation_entry(entry: BibEntry) -> CitationEntry {
    let mut parts = Vec::new();
    if let Some(a) = entry.author {
        parts.push(a);
    }
    if let Some(t) = entry.title {
        parts.push(format!("*{t}*"));
    }
    if let Some(y) = entry.year {
        parts.push(y);
    }
    let detail = if parts.is_empty() { None } else { Some(parts.join(", ")) };
    CitationEntry { key: entry.key, detail }
}

fn skip_spaces(s: &str, mut pos: usize) -> usize {
    let bytes = s.as_bytes();
    while bytes.get(pos).is_some_and(u8::is_ascii_whitespace) {
        pos += 1;
    }
    pos
}

/// Longest-name-first, same discipline as [`classify`]. `\DeclareMathOperator` isn't a prefix of
/// anything else here, but keeping the ordering convention consistent costs nothing.
fn classify_macro_command(rest: &str) -> Option<(&'static str, usize)> {
    const COMMANDS: &[(&str, &str)] = &[
        ("\\DeclareMathOperator", "declaremathoperator"),
        ("\\newcommand", "newcommand"),
        ("\\def", "def"),
    ];
    COMMANDS.iter().find(|(name, _)| rest.starts_with(name)).map(|(name, tag)| (*tag, name.len()))
}

/// Scans `stripped` for `\newcommand`/`\def`/`\DeclareMathOperator` definitions. Unlike
/// `scan_into`, an entry that doesn't parse as one of these three recognized shapes is dropped
/// entirely rather than guessed at -- per this task's own instruction, a macro indexed with the
/// wrong arity is a *wrong* completion, worse than a missing one.
fn find_macros(stripped: &str) -> Vec<MacroDef> {
    let mut macros = Vec::new();
    let bytes = stripped.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] != b'\\' {
            i += 1;
            continue;
        }
        let Some((tag, name_len)) = classify_macro_command(&stripped[i..]) else {
            i += 1;
            continue;
        };

        let mut after = i + name_len;
        if bytes.get(after) == Some(&b'*') {
            after += 1;
        }

        let parsed = match tag {
            "newcommand" => parse_newcommand(stripped, after),
            "declaremathoperator" => parse_declare_math_operator(stripped, after),
            "def" => parse_def(stripped, after),
            _ => unreachable!("classify_macro_command only returns these three tags"),
        };

        match parsed {
            Some((macro_def, next_i)) => {
                macros.push(macro_def);
                i = next_i;
            }
            None => i = after,
        }
    }
    macros
}

/// `\newcommand{\name}[N][default]{body}` or `\newcommand\name[N]{body}` (both forms of naming
/// are real LaTeX). The optional second `[default]` bracket (an optional first argument) is
/// skipped without changing `arity` -- it doesn't add a required `{}` group, so it doesn't add a
/// tabstop either.
fn parse_newcommand(stripped: &str, after: usize) -> Option<(MacroDef, usize)> {
    let bytes = stripped.as_bytes();
    let pos = skip_spaces(stripped, after);

    let (name, pos) = if bytes.get(pos) == Some(&b'{') {
        let close = matching_brace(stripped, pos)?;
        let name = stripped[pos + 1..close].trim().strip_prefix('\\')?.to_string();
        (name, close + 1)
    } else if bytes.get(pos) == Some(&b'\\') {
        let mut end = pos + 1;
        while bytes.get(end).is_some_and(u8::is_ascii_alphabetic) {
            end += 1;
        }
        if end == pos + 1 {
            return None;
        }
        (stripped[pos + 1..end].to_string(), end)
    } else {
        return None;
    };

    let mut pos = skip_spaces(stripped, pos);
    let mut arity = 0u32;
    if bytes.get(pos) == Some(&b'[') {
        let close = pos + stripped[pos..].find(']')?;
        arity = stripped[pos + 1..close].trim().parse().ok()?;
        pos = skip_spaces(stripped, close + 1);
        if bytes.get(pos) == Some(&b'[') {
            let close2 = pos + stripped[pos..].find(']')?;
            pos = skip_spaces(stripped, close2 + 1);
        }
    }

    if bytes.get(pos) != Some(&b'{') {
        return None;
    }
    let close = matching_brace(stripped, pos)?;
    let body = stripped[pos + 1..close].trim().to_string();
    Some((MacroDef { name, arity, body }, close + 1))
}

/// `\DeclareMathOperator{\name}{text}` (and the starred limits-style variant, star already
/// consumed by the caller) -- always arity 0, structurally fixed (no `[N]` at all).
fn parse_declare_math_operator(stripped: &str, after: usize) -> Option<(MacroDef, usize)> {
    let bytes = stripped.as_bytes();
    let pos = skip_spaces(stripped, after);
    if bytes.get(pos) != Some(&b'{') {
        return None;
    }
    let name_close = matching_brace(stripped, pos)?;
    let name = stripped[pos + 1..name_close].trim().strip_prefix('\\')?.to_string();

    let pos2 = skip_spaces(stripped, name_close + 1);
    if bytes.get(pos2) != Some(&b'{') {
        return None;
    }
    let body_close = matching_brace(stripped, pos2)?;
    let body = stripped[pos2 + 1..body_close].trim().to_string();

    Some((MacroDef { name, arity: 0, body }, body_close + 1))
}

/// `\def\name#1#2{body}` (plain TeX). Only the common undelimited `#1#2...#N` parameter-text
/// shape is supported -- TeX's `\def` also allows delimited parameters with literal tokens
/// between `#`s (`\def\foo#1,#2.{...}`), which is unparseable here on purpose: guessing an arity
/// for that shape risks exactly the "wrong, not missing" completion this task warns against, so
/// it's dropped instead.
fn parse_def(stripped: &str, after: usize) -> Option<(MacroDef, usize)> {
    let bytes = stripped.as_bytes();
    let pos = skip_spaces(stripped, after);
    if bytes.get(pos) != Some(&b'\\') {
        return None;
    }
    let mut name_end = pos + 1;
    while bytes.get(name_end).is_some_and(u8::is_ascii_alphabetic) {
        name_end += 1;
    }
    if name_end == pos + 1 {
        return None;
    }
    let name = stripped[pos + 1..name_end].to_string();

    let mut cursor = name_end;
    let mut arity = 0u32;
    loop {
        match bytes.get(cursor) {
            Some(b'{') => break,
            Some(b'#') => {
                let digit_pos = cursor + 1;
                let n = bytes.get(digit_pos).filter(|b| b.is_ascii_digit()).map(|b| (b - b'0') as u32)?;
                if n != arity + 1 {
                    return None; // out-of-order/skipped parameter numbering -- not the common case
                }
                arity = n;
                cursor = digit_pos + 1;
            }
            _ => return None, // a literal delimiter token in the parameter text -- unsupported, see doc comment
        }
    }

    let close = matching_brace(stripped, cursor)?;
    let body = stripped[cursor + 1..close].trim().to_string();
    Some((MacroDef { name, arity, body }, close + 1))
}

/// `\usepackage[options]{pkg1,pkg2}` -- Section 9.4 lists this under `.tex` files' extracted data
/// without giving it its own numbered task; 3.5 depends on it for CTAN command scoping.
fn find_packages(stripped: &str) -> Vec<String> {
    const CMD: &str = "\\usepackage";
    let mut packages = Vec::new();
    let bytes = stripped.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] != b'\\' || !stripped[i..].starts_with(CMD) {
            i += 1;
            continue;
        }

        let mut after = i + CMD.len();
        if bytes.get(after) == Some(&b'[') {
            if let Some(end) = stripped[after..].find(']') {
                after += end + 1;
            }
        }
        if bytes.get(after) != Some(&b'{') {
            i += CMD.len();
            continue;
        }
        let Some(close) = matching_brace(stripped, after) else {
            i += CMD.len();
            continue;
        };

        packages.extend(stripped[after + 1..close].split(',').map(str::trim).filter(|s| !s.is_empty()).map(str::to_string));
        i = close + 1;
    }
    packages
}

/// Project-relative, forward-slash-normalized paths of every real `.tex` file and every real
/// image file (`project::GRAPHIC_EXTENSIONS`) under `base_dir`, in one filesystem walk -- not two
/// separate ones. Unlike everything else in this module, this walks the filesystem directly
/// rather than scanning `.tex` source -- the candidate set is "what files exist," not "what's
/// already referenced." Skips [`project::SKIP_NAMES`] and guards against symlink cycles the same
/// way `project::root`'s own directory walk does; kept as a separate implementation (not reusing
/// that private, `.tex`-specific one) to avoid risking a regression in already-shipped
/// root-detection code for a DRY win.
fn find_path_candidates(base_dir: &Path) -> (Vec<String>, Vec<String>) {
    let mut visited = HashSet::new();
    let mut tex_paths = Vec::new();
    let mut graphic_paths = Vec::new();
    walk_project_files(base_dir, base_dir, &mut visited, &mut tex_paths, &mut graphic_paths);
    tex_paths.sort();
    graphic_paths.sort();
    (tex_paths, graphic_paths)
}

fn walk_project_files(
    base_dir: &Path,
    dir: &Path,
    visited: &mut HashSet<PathBuf>,
    tex_paths: &mut Vec<String>,
    graphic_paths: &mut Vec<String>,
) {
    let Ok(real_dir) = dir.canonicalize() else {
        return;
    };
    if !visited.insert(real_dir) {
        return;
    }
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let name = entry.file_name();
        if project::SKIP_NAMES.contains(&name.to_string_lossy().as_ref()) {
            continue;
        }
        let path = entry.path();
        if path.is_dir() {
            walk_project_files(base_dir, &path, visited, tex_paths, graphic_paths);
            continue;
        }
        let Some(ext) = path.extension() else { continue };
        let bucket = if ext.eq_ignore_ascii_case("tex") {
            Some(&mut *tex_paths)
        } else if project::GRAPHIC_EXTENSIONS.iter().any(|e| ext.eq_ignore_ascii_case(e)) {
            Some(&mut *graphic_paths)
        } else {
            None
        };
        if let Some(bucket) = bucket {
            if let Ok(rel) = path.strip_prefix(base_dir) {
                bucket.push(rel.to_string_lossy().replace('\\', "/"));
            }
        }
    }
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

/// The command name (e.g. `"ref"`, `"cite"`) immediately before the innermost unclosed `{`
/// preceding `position` in `text`, if any -- the shared trigger-detection primitive behind every
/// `is_*_completion_context` check. Scans backward from the cursor tracking brace depth; stops at
/// the first line break, since a command argument relevant to completion (a ref, a citation) is
/// never expected to span multiple lines. `None` if the cursor isn't inside a same-line unclosed
/// brace argument at all, or if what's immediately before that `{` isn't a bare command name
/// (e.g. `\ref {` with a space, or plain text -- both real but rare/irrelevant edge cases).
fn enclosing_command(text: &str, position: &Position) -> Option<String> {
    let cursor = byte_offset_of(text, position).min(text.len());
    let before = &text[..cursor];
    let bytes = before.as_bytes();
    let mut depth = 0i32;
    let mut i = before.len();
    while i > 0 {
        i -= 1;
        match bytes[i] {
            b'\n' => return None,
            b'}' => depth += 1,
            b'{' => {
                if depth != 0 {
                    depth -= 1;
                    continue;
                }
                // An optional [options] block can sit between the command name and this brace --
                // \includegraphics[width=5cm]{...} and even plain LaTeX's \cite[p. 5]{...} both
                // do this. Skip backward over it before looking for the command name.
                let mut prefix = &before[..i];
                if prefix.ends_with(']') {
                    let open = find_matching_open_bracket(prefix)?;
                    prefix = &prefix[..open];
                }
                let backslash = prefix.rfind('\\')?;
                let name = &prefix[backslash + 1..];
                return (!name.is_empty() && name.chars().all(|c| c.is_ascii_alphabetic())).then(|| name.to_string());
            }
            _ => {}
        }
    }
    None
}

/// `prefix` ends with `]`; finds the byte offset of its matching `[`, scanning backward and
/// honoring nesting -- mirrors [`matching_brace`]'s logic but for `[...]` and in reverse. No
/// escape handling: `[key=value]`-style option blocks don't realistically contain `\[`/`\]`.
fn find_matching_open_bracket(prefix: &str) -> Option<usize> {
    let bytes = prefix.as_bytes();
    let mut depth = 0i32;
    let mut i = prefix.len();
    while i > 0 {
        i -= 1;
        match bytes[i] {
            b']' => depth += 1,
            b'[' => {
                depth -= 1;
                if depth == 0 {
                    return Some(i);
                }
            }
            _ => {}
        }
    }
    None
}

/// Trigger context for label completion (Section 9.4's `\ref`/`\eqref`/`\autoref` sites, task 3.1).
pub fn is_ref_completion_context(text: &str, position: &Position) -> bool {
    matches!(enclosing_command(text, position).as_deref(), Some("ref") | Some("eqref") | Some("autoref"))
}

/// Trigger context for citation completion (Section 9.4's `\cite{` sites, task 3.2). Just `\cite`
/// -- natbib/biblatex variants (`\citep`, `\parencite`, ...) aren't offered since this project
/// compiles with classic BibTeX only (9.1's documented Tectonic/biber limitation), so they'd be
/// suggesting syntax the compile pipeline can't actually use.
pub fn is_cite_completion_context(text: &str, position: &Position) -> bool {
    enclosing_command(text, position).as_deref() == Some("cite")
}

/// Trigger context for bare command-name completion (task 3.3's macros today; 3.5's CTAN
/// commands will feed the same trigger later, ranked below project-local macros per Section
/// 9.4). True when the cursor is right after `\` plus zero or more letters and nothing else --
/// deliberately distinct from [`enclosing_command`]'s "inside a `{` argument" shape, and mutually
/// exclusive with it: any `{`, `}`, or other non-letter since the last backslash rules this out.
pub fn is_command_completion_context(text: &str, position: &Position) -> bool {
    let cursor = byte_offset_of(text, position).min(text.len());
    let before = &text[..cursor];
    let Some(backslash) = before.rfind('\\') else {
        return false;
    };
    before[backslash + 1..].chars().all(|c| c.is_ascii_alphabetic())
}

/// Trigger context for `\input`/`\include` file-path completion (task 3.4). Both take only
/// `.tex` files (Section 9.4), so they share one context check.
pub fn is_input_completion_context(text: &str, position: &Position) -> bool {
    matches!(enclosing_command(text, position).as_deref(), Some("input") | Some("include"))
}

/// Trigger context for `\includegraphics` file-path completion (task 3.4) -- a separate check
/// from [`is_input_completion_context`] since it filters to a different extension set.
pub fn is_includegraphics_completion_context(text: &str, position: &Position) -> bool {
    enclosing_command(text, position).as_deref() == Some("includegraphics")
}

#[cfg(test)]
mod tests {
    use std::fs;

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
        let index = index_file(content, Path::new("main.tex"), Path::new("."));

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
        let index = index_file(content, Path::new("main.tex"), Path::new("."));

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
        let index = index_file(content, Path::new("main.tex"), Path::new("."));
        assert_eq!(index.outline.len(), 2);
        assert_eq!(index.outline[0].kind, OutlineNodeKind::Label);
        assert_eq!(index.outline[1].kind, OutlineNodeKind::Section);
    }

    #[test]
    fn commented_out_label_is_not_indexed() {
        let content = "% \\label{ignored}\n\\section{Real}\n\\label{real}\n";
        let index = index_file(content, Path::new("main.tex"), Path::new("."));
        assert_eq!(index.labels.iter().map(|l| l.name.as_str()).collect::<Vec<_>>(), vec!["real"]);
    }

    /// Position at the very end of `text` -- the completion-context tests only ever care about
    /// "cursor right after what was just typed," never mid-document.
    fn end_position(text: &str) -> Position {
        let line = text.matches('\n').count() as u32;
        let col_start = text.rfind('\n').map(|i| i + 1).unwrap_or(0);
        Position { line, column: text[col_start..].encode_utf16().count() as u32 }
    }

    #[test]
    fn ref_context_detects_ref_eqref_autoref_but_not_other_commands() {
        for cmd in ["\\ref{", "\\eqref{", "\\autoref{", "\\ref{sec:in"] {
            assert!(is_ref_completion_context(cmd, &end_position(cmd)), "{cmd:?} should be a ref context");
        }
        for text in ["\\cite{", "\\textbf{", "\\ref{done} ", "no braces at all", "\\myref{"] {
            assert!(!is_ref_completion_context(text, &end_position(text)), "{text:?} should not be a ref context");
        }
    }

    #[test]
    fn ref_context_does_not_cross_line_boundaries() {
        let text = "\\ref{\nsec:x";
        let pos = Position { line: 1, column: 4 };
        assert!(!is_ref_completion_context(text, &pos));
    }

    #[test]
    fn cite_context_detects_cite_but_not_ref_or_other_commands() {
        for cmd in ["\\cite{", "\\cite{knuth"] {
            assert!(is_cite_completion_context(cmd, &end_position(cmd)), "{cmd:?} should be a cite context");
        }
        // natbib/biblatex variants deliberately not recognized -- see is_cite_completion_context's doc comment.
        for text in ["\\ref{", "\\citep{", "\\citet{", "\\parencite{", "no braces at all"] {
            assert!(!is_cite_completion_context(text, &end_position(text)), "{text:?} should not be a cite context");
        }
    }

    #[test]
    fn parse_bib_extracts_author_title_year_and_skips_directives() {
        let content = r#"
@comment{ignore this whole thing}
@string{cs = "Computer Science"}
@book{knuth1984,
  author = {Donald E. Knuth},
  title = {The {TeX}book},
  year = {1984},
  publisher = {Addison-Wesley}
}
@preamble{"ignored too"}
"#;
        let entries = parse_bib(content);
        assert_eq!(entries.len(), 1, "comment/string/preamble must not be citable entries: {:?}", entries.iter().map(|e| &e.key).collect::<Vec<_>>());
        let e = &entries[0];
        assert_eq!(e.key, "knuth1984");
        assert_eq!(e.author.as_deref(), Some("Donald E. Knuth"));
        assert_eq!(e.title.as_deref(), Some("The TeXbook"), "case-protection braces must not survive into the display value");
        assert_eq!(e.year.as_deref(), Some("1984"));
    }

    #[test]
    fn parse_bib_handles_last_comma_first_author_and_bare_year() {
        // A field value's own internal comma (the "Last, First" convention) must not be mistaken
        // for the entry's own field separator.
        let content = "@article{lamport1994,\n  author = {Lamport, Leslie},\n  year = 1994\n}\n";
        let entries = parse_bib(content);
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].author.as_deref(), Some("Lamport, Leslie"));
        assert_eq!(entries[0].year.as_deref(), Some("1994"), "a bare unbraced value must parse too");
    }

    #[test]
    fn parse_bib_entry_with_no_fields_still_gets_a_key() {
        let content = "@misc{bare_key}\n";
        let entries = parse_bib(content);
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].key, "bare_key");
        assert!(entries[0].author.is_none() && entries[0].title.is_none() && entries[0].year.is_none());
    }

    #[test]
    fn citation_entry_detail_omits_missing_fields_without_a_dangling_separator() {
        let full = citation_entry(BibEntry {
            key: "k".to_string(),
            author: Some("A. Author".to_string()),
            title: Some("A Title".to_string()),
            year: Some("2024".to_string()),
        });
        assert_eq!(full.detail.as_deref(), Some("A. Author, *A Title*, 2024"));

        let no_year = citation_entry(BibEntry { key: "k".to_string(), author: Some("A".to_string()), title: Some("T".to_string()), year: None });
        assert_eq!(no_year.detail.as_deref(), Some("A, *T*"));

        let nothing = citation_entry(BibEntry { key: "k".to_string(), author: None, title: None, year: None });
        assert_eq!(nothing.detail, None);
    }

    #[test]
    fn bib_resource_resolution_confines_to_project_dir_and_supports_both_commands() {
        let dir = std::env::temp_dir().join(format!("quire-index-bib-resolve-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("refs.bib"), "@misc{k,}").unwrap();
        let outside = std::env::temp_dir().join(format!("quire-index-bib-resolve-outside-{}", std::process::id()));
        fs::create_dir_all(&outside).unwrap();
        fs::write(outside.join("secret.bib"), "@misc{k,}").unwrap();

        let stripped = format!(
            "\\bibliography{{refs}}\n\\addbibresource{{refs.bib}}\n\\bibliography{{../{}/secret}}\n",
            outside.file_name().unwrap().to_string_lossy()
        );
        let found = find_bib_resources(&stripped, &dir);

        assert!(found.contains(&dir.join("refs.bib")), "\\bibliography{{refs}} and \\addbibresource{{refs.bib}} should both resolve: {found:?}");
        assert!(!found.iter().any(|p| p.ends_with("secret.bib")), "a \\bibliography escaping the project dir must not resolve: {found:?}");

        fs::remove_dir_all(&dir).ok();
        fs::remove_dir_all(&outside).ok();
    }

    #[test]
    fn cite_context_does_not_overlap_with_command_context() {
        for cmd in ["\\ref{", "\\cite{sec"] {
            assert!(!is_command_completion_context(cmd, &end_position(cmd)), "{cmd:?} is an argument context, not a bare command context");
        }
        for cmd in ["\\vec", "\\", "\\v"] {
            assert!(is_command_completion_context(cmd, &end_position(cmd)), "{cmd:?} should be a bare command context");
        }
    }

    #[test]
    fn newcommand_with_bracket_arity_and_braced_name() {
        let macros = find_macros("\\newcommand{\\vect}[1]{\\mathbf{#1}}");
        assert_eq!(macros.len(), 1);
        assert_eq!(macros[0].name, "vect");
        assert_eq!(macros[0].arity, 1);
        assert_eq!(macros[0].body, "\\mathbf{#1}");
    }

    #[test]
    fn newcommand_with_no_arity_and_bare_name() {
        let macros = find_macros("\\newcommand\\greeting{Hello, world}");
        assert_eq!(macros.len(), 1);
        assert_eq!(macros[0].name, "greeting");
        assert_eq!(macros[0].arity, 0);
        assert_eq!(macros[0].body, "Hello, world");
    }

    #[test]
    fn newcommand_star_and_optional_default_argument_do_not_change_arity() {
        let macros = find_macros("\\newcommand*{\\greet}[2][Hello]{#1, #2!}");
        assert_eq!(macros.len(), 1);
        assert_eq!(macros[0].name, "greet");
        assert_eq!(macros[0].arity, 2, "the [Hello] default-value bracket must not be counted as arity");
        assert_eq!(macros[0].body, "#1, #2!");
    }

    #[test]
    fn def_counts_hash_parameters() {
        let macros = find_macros("\\def\\foo#1#2{(#1,#2)}");
        assert_eq!(macros.len(), 1);
        assert_eq!(macros[0].name, "foo");
        assert_eq!(macros[0].arity, 2);
        assert_eq!(macros[0].body, "(#1,#2)");
    }

    #[test]
    fn def_with_delimited_parameters_is_unparseable_and_skipped() {
        // `\def\foo#1,#2.{...}` -- a literal `,` token between parameters. Getting this wrong
        // (guessing arity 2 and ignoring the delimiters) would be a *wrong* completion; dropping
        // it entirely is the documented tradeoff.
        let macros = find_macros("\\def\\foo#1,#2.{body}");
        assert!(macros.is_empty(), "delimited \\def parameters must be dropped, not guessed at: {macros:?}");
    }

    #[test]
    fn declare_math_operator_is_always_arity_zero() {
        let macros = find_macros("\\DeclareMathOperator{\\argmax}{arg\\,max}");
        assert_eq!(macros.len(), 1);
        assert_eq!(macros[0].name, "argmax");
        assert_eq!(macros[0].arity, 0);

        let starred = find_macros("\\DeclareMathOperator*{\\lim}{lim}");
        assert_eq!(starred.len(), 1);
        assert_eq!(starred[0].name, "lim");
        assert_eq!(starred[0].arity, 0);
    }

    #[test]
    fn macro_scan_does_not_misfire_on_lookalike_commands() {
        // \newcommandy isn't \newcommand; \defer isn't \def; the "next char must be brace/backslash/whitespace-then-those" check must reject both.
        assert!(find_macros("\\newcommandy{\\x}{y}").is_empty());
    }

    #[test]
    fn find_packages_handles_options_and_comma_lists() {
        let packages = find_packages("\\usepackage[utf8]{inputenc}\n\\usepackage{tikz,amsmath}\n");
        assert_eq!(packages, vec!["inputenc", "tikz", "amsmath"]);
    }

    #[test]
    fn enclosing_command_skips_an_optional_bracket_before_the_brace() {
        for cmd in ["\\includegraphics[width=5cm]{", "\\includegraphics[width=5cm]{fig"] {
            assert!(is_includegraphics_completion_context(cmd, &end_position(cmd)), "{cmd:?} should be an includegraphics context");
        }
        // Plain LaTeX's own \cite takes an optional note argument too, not just natbib/biblatex.
        let cite_with_note = "\\cite[p. 5]{";
        assert!(is_cite_completion_context(cite_with_note, &end_position(cite_with_note)));
    }

    #[test]
    fn input_and_includegraphics_contexts_are_distinct_and_do_not_overlap_with_ref_or_cite() {
        for cmd in ["\\input{", "\\include{"] {
            assert!(is_input_completion_context(cmd, &end_position(cmd)), "{cmd:?} should be an input context");
            assert!(!is_includegraphics_completion_context(cmd, &end_position(cmd)));
        }
        let graphic = "\\includegraphics{";
        assert!(is_includegraphics_completion_context(graphic, &end_position(graphic)));
        assert!(!is_input_completion_context(graphic, &end_position(graphic)));

        for cmd in ["\\ref{", "\\cite{"] {
            assert!(!is_input_completion_context(cmd, &end_position(cmd)));
            assert!(!is_includegraphics_completion_context(cmd, &end_position(cmd)));
        }
    }

    #[test]
    fn find_path_candidates_filters_by_extension_skips_dotfolders_and_normalizes_separators() {
        let dir = std::env::temp_dir().join(format!("quire-index-path-candidates-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(dir.join("chapters")).unwrap();
        fs::create_dir_all(dir.join("figures")).unwrap();
        fs::create_dir_all(dir.join("node_modules")).unwrap();
        fs::write(dir.join("main.tex"), "").unwrap();
        fs::write(dir.join("chapters").join("intro.tex"), "").unwrap();
        fs::write(dir.join("figures").join("plot.pdf"), "").unwrap();
        fs::write(dir.join("figures").join("plot.PNG"), "").unwrap(); // extension case shouldn't matter
        fs::write(dir.join("node_modules").join("ignored.tex"), "").unwrap();

        let (tex, graphics) = find_path_candidates(&dir);
        assert_eq!(tex, vec!["chapters/intro.tex", "main.tex"], "sorted, node_modules excluded, forward slashes even if built on a platform that uses '\\'");
        assert_eq!(graphics, vec!["figures/plot.PNG", "figures/plot.pdf"]);

        fs::remove_dir_all(&dir).ok();
    }

}
