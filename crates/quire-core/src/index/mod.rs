pub mod ctan;
pub mod symbols;

use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};

use crate::project::{self, FileGraph, FileKind};
use crate::rpc::{OutlineNode, OutlineNodeKind, Position};

#[derive(Debug, Clone)]
pub struct LabelDef {
    pub name: String,
    pub uri: PathBuf,
    pub position: Position,
}

#[derive(Debug, Clone)]
pub struct CitationEntry {
    pub key: String,
    /// `None` only when the entry has none of author/title/year at all.
    pub detail: Option<String>,
}

#[derive(Debug, Clone)]
pub struct MacroDef {
    /// Without the leading backslash, matching [`LabelDef::name`]/[`CitationEntry::key`]'s convention.
    pub name: String,
    /// How many required `{}` arguments - what turns into `insert`'s `${1:...}` tabstops.
    pub arity: u32,
    /// Not used for `insert` (arity-driven, not body-driven) - just a readable `detail` for the popup.
    pub body: String,
}

struct FileIndex {
    outline: Vec<OutlineNode>,
    labels: Vec<LabelDef>,
    bib_resources: Vec<PathBuf>,
    macros: Vec<MacroDef>,
    packages: Vec<String>,
    document_class: Option<String>,
}

pub struct ProjectIndex {
    files: HashMap<PathBuf, FileIndex>,
    citations: Vec<CitationEntry>,
    macros: Vec<MacroDef>,
    packages: HashSet<String>,
    document_classes: HashSet<String>,
    tex_paths: Vec<String>,
    graphic_paths: Vec<String>,
}

impl ProjectIndex {
    pub fn build(graph: &FileGraph) -> Self {
        // Same convention as `build_file_graph`: paths resolve against the root document's directory.
        let base_dir = graph.root.parent().unwrap_or_else(|| Path::new("."));

        let mut files = HashMap::with_capacity(graph.files.len());
        let mut bib_paths: HashSet<PathBuf> = HashSet::new();
        // Keyed by name so a macro redefined (or duplicated across files) shows up once; last one scanned wins.
        let mut macros: HashMap<String, MacroDef> = HashMap::new();
        let mut packages: HashSet<String> = HashSet::new();
        let mut document_classes: HashSet<String> = HashSet::new();

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
            document_classes.extend(index.document_class.iter().cloned());
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

        // Filesystem walk, not FileGraph - offers files not yet \input/\includegraphics'd, which FileGraph can't provide.
        let (tex_paths, graphic_paths) = find_path_candidates(base_dir);

        ProjectIndex { files, citations, macros, packages, document_classes, tex_paths, graphic_paths }
    }

    pub fn outline_for(&self, uri: &Path) -> Vec<OutlineNode> {
        self.files.get(uri).map(|f| f.outline.clone()).unwrap_or_default()
    }

    pub fn labels(&self) -> impl Iterator<Item = &LabelDef> {
        self.files.values().flat_map(|f| f.labels.iter())
    }

    pub fn citations(&self) -> impl Iterator<Item = &CitationEntry> {
        self.citations.iter()
    }

    pub fn macros(&self) -> impl Iterator<Item = &MacroDef> {
        self.macros.iter()
    }

    pub fn packages(&self) -> impl Iterator<Item = &str> {
        self.packages.iter().map(|s| s.as_str())
    }

    pub fn document_classes(&self) -> impl Iterator<Item = &str> {
        self.document_classes.iter().map(|s| s.as_str())
    }

    pub fn tex_paths(&self) -> impl Iterator<Item = &str> {
        self.tex_paths.iter().map(|s| s.as_str())
    }

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
    let document_class = crate::project::documentclass_name(&stripped);

    FileIndex { outline, labels, bib_resources, macros, packages, document_class }
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

/// Longest-name-first order avoids a prefix collision (e.g. `\section` matching inside `\subsection`).
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

/// Scans into a heading's `{...}` argument rather than skipping it, so a nested `\label{}` is still found.
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
            let title = strip_label_commands(raw_arg).trim().to_string();
            entries.push(RawEntry { kind, text: title, position });
            i = after + 1; // into the argument, not past it - see doc comment above
        }
    }
}

/// Char-based, not byte indexing, so skipping an escaped character can't land mid multi-byte UTF-8 and panic.
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

/// Only `\label` is stripped; other markup is left as-is - rendering LaTeX to plain text is out of scope.
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
        // The following `{`-check rejects \bibliographystyle{...} false-matching this prefix.
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

/// Splits on `sep` only at brace/quote depth 0 - a bib value routinely contains a raw comma itself.
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

/// Also strips remaining brace characters - BibTeX's case-protection braces are a typesetting artifact.
fn unwrap_bib_value(raw: &str) -> String {
    let trimmed = raw.trim();
    let unwrapped = trimmed
        .strip_prefix('{')
        .and_then(|s| s.strip_suffix('}'))
        .or_else(|| trimmed.strip_prefix('"').and_then(|s| s.strip_suffix('"')))
        .unwrap_or(trimmed);
    unwrapped.chars().filter(|&c| c != '{' && c != '}').collect::<String>().trim().to_string()
}

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

fn classify_macro_command(rest: &str) -> Option<(&'static str, usize)> {
    const COMMANDS: &[(&str, &str)] = &[
        ("\\DeclareMathOperator", "declaremathoperator"),
        ("\\newcommand", "newcommand"),
        ("\\def", "def"),
    ];
    COMMANDS.iter().find(|(name, _)| rest.starts_with(name)).map(|(name, tag)| (*tag, name.len()))
}

/// An entry that doesn't parse as one of these three shapes is dropped - a wrong arity is worse than a missing completion.
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

/// The optional `[default]` bracket doesn't add a required `{}` group, so it doesn't count toward `arity`.
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

/// Only the common undelimited `#1#2...#N` shape is supported; delimited `\def` params are dropped, not guessed.
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
                    return None; // out-of-order/skipped parameter numbering - not the common case
                }
                arity = n;
                cursor = digit_pos + 1;
            }
            _ => return None, // a literal delimiter token in the parameter text - unsupported, see doc comment
        }
    }

    let close = matching_brace(stripped, cursor)?;
    let body = stripped[cursor + 1..close].trim().to_string();
    Some((MacroDef { name, arity, body }, close + 1))
}

/// `\usepackage` and `\RequirePackage` share the same `[options]{name1,name2}` shape and meaning here.
fn find_packages(stripped: &str) -> Vec<String> {
    let mut packages = find_brace_list_command(stripped, "\\usepackage");
    packages.extend(find_brace_list_command(stripped, "\\RequirePackage"));
    packages
}

fn find_brace_list_command(stripped: &str, cmd: &str) -> Vec<String> {
    let mut names = Vec::new();
    let bytes = stripped.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] != b'\\' || !stripped[i..].starts_with(cmd) {
            i += 1;
            continue;
        }

        let mut after = i + cmd.len();
        if bytes.get(after) == Some(&b'[') {
            if let Some(end) = stripped[after..].find(']') {
                after += end + 1;
            }
        }
        if bytes.get(after) != Some(&b'{') {
            i += cmd.len();
            continue;
        }
        let Some(close) = matching_brace(stripped, after) else {
            i += cmd.len();
            continue;
        };

        names.extend(stripped[after + 1..close].split(',').map(str::trim).filter(|s| !s.is_empty()).map(str::to_string));
        i = close + 1;
    }
    names
}

/// Walks the filesystem directly for what exists, not reusing `project::root`'s own walk of what's referenced.
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

/// Every `.tex`/`.bib` file under `project_dir`, absolute paths, same skip-list as `find_path_candidates` - used by project-wide search/replace only.
pub(crate) fn all_searchable_files(project_dir: &Path) -> Vec<PathBuf> {
    let mut visited = HashSet::new();
    let mut files = Vec::new();
    walk_searchable_files(project_dir, &mut visited, &mut files);
    files.sort();
    files
}

fn walk_searchable_files(dir: &Path, visited: &mut HashSet<PathBuf>, files: &mut Vec<PathBuf>) {
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
            walk_searchable_files(&path, visited, files);
            continue;
        }
        let Some(ext) = path.extension() else { continue };
        if ext.eq_ignore_ascii_case("tex") || ext.eq_ignore_ascii_case("bib") {
            files.push(path);
        }
    }
}

/// Byte offset -> `Position` (0-based line, 0-based UTF-16 units), CodeMirror/LSP convention.
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

/// Inverse of [`position_at`]; out-of-range lines/columns clamp to the nearest valid offset rather than panicking.
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

/// A `\label` never opens a nesting level - it attaches as a leaf under the innermost-open heading.
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

/// Scans backward tracking brace depth, stopping at the first line break - a command argument here never spans lines.
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
                // An optional [options] block can sit between the command name and this brace; skip it first.
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

/// Mirrors [`matching_brace`] but for `[...]` in reverse; no escape handling since option blocks don't need it.
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

pub fn is_ref_completion_context(text: &str, position: &Position) -> bool {
    matches!(enclosing_command(text, position).as_deref(), Some("ref") | Some("eqref") | Some("autoref"))
}

/// Just `\cite` - natbib/biblatex variants aren't offered since this pipeline only supports classic BibTeX.
pub fn is_cite_completion_context(text: &str, position: &Position) -> bool {
    enclosing_command(text, position).as_deref() == Some("cite")
}

/// True right after `\` plus letters and nothing else; mutually exclusive with [`enclosing_command`]'s shape.
pub fn is_command_completion_context(text: &str, position: &Position) -> bool {
    let cursor = byte_offset_of(text, position).min(text.len());
    let before = &text[..cursor];
    let Some(backslash) = before.rfind('\\') else {
        return false;
    };
    before[backslash + 1..].chars().all(|c| c.is_ascii_alphabetic())
}

pub fn is_input_completion_context(text: &str, position: &Position) -> bool {
    matches!(enclosing_command(text, position).as_deref(), Some("input") | Some("include"))
}

pub fn is_includegraphics_completion_context(text: &str, position: &Position) -> bool {
    enclosing_command(text, position).as_deref() == Some("includegraphics")
}

#[cfg(test)]
mod tests {
    use std::fs;

    use super::*;

    #[test]
    fn position_at_counts_utf16_units_not_bytes() {
        // "café" + emoji covers both a 2-byte non-surrogate char and a surrogate pair.
        let content = "café \u{1F600} x";
        let x_byte = content.rfind('x').unwrap();
        let pos = position_at(content, x_byte);
        assert_eq!(pos, Position { line: 0, column: "café \u{1F600} ".encode_utf16().count() as u32 });
    }

    #[test]
    fn byte_offset_of_is_the_inverse_of_position_at() {
        let content = "line one\nsecond café line\nthird";
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
        // natbib/biblatex variants deliberately not recognized - see is_cite_completion_context's doc comment.
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
        assert!(find_macros("\\newcommandy{\\x}{y}").is_empty());
    }

    #[test]
    fn find_packages_handles_options_and_comma_lists() {
        let packages = find_packages("\\usepackage[utf8]{inputenc}\n\\usepackage{tikz,amsmath}\n");
        assert_eq!(packages, vec!["inputenc", "tikz", "amsmath"]);
    }

    #[test]
    fn find_packages_also_matches_requirepackage() {
        // \usepackage matches collect before \RequirePackage's regardless of source order.
        let packages = find_packages("\\RequirePackage{xkeyval}\n\\usepackage{amsmath}\n");
        assert_eq!(packages, vec!["amsmath", "xkeyval"]);
    }

    #[test]
    fn enclosing_command_skips_an_optional_bracket_before_the_brace() {
        for cmd in ["\\includegraphics[width=5cm]{", "\\includegraphics[width=5cm]{fig"] {
            assert!(is_includegraphics_completion_context(cmd, &end_position(cmd)), "{cmd:?} should be an includegraphics context");
        }
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
