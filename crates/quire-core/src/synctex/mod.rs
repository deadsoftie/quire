use std::collections::HashMap;
use std::io::Read;
use std::path::{Path, PathBuf};

/// SP (TeX scaled points) per PDF "big point" (1/72in), the standard
/// SyncTeX conversion constant.
const SP_PER_BIGPT: f64 = 65781.76;

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Rect {
    pub page: u32,
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Confidence {
    High,
    Low,
}

#[derive(Debug, Clone, Copy)]
struct Node {
    page: u32,
    tag: u32,
    line: u32,
    // SyncTeX convention: (h, v) is the baseline-left reference point; the
    // box spans [h, h+width] horizontally and [v-height, v+depth]
    // vertically.
    h: i64,
    v: i64,
    width: i64,
    height: i64,
    depth: i64,
    /// '[' or '(': a box *container* (a paragraph's enclosing vbox, the
    /// whole page's outer box, ...), tagged with whatever line *closes*
    /// it -- often nowhere near the line it visually spans. 'h'/'v'/'k'/'g'
    /// are leaves: precise per-word/kern/glue position markers, tagged
    /// with the actual line they're on. See `inverse_sync`.
    is_container: bool,
}

fn node_rect(n: &Node) -> Rect {
    let to_bp = |sp: i64| sp as f64 / SP_PER_BIGPT;
    Rect {
        page: n.page,
        x: to_bp(n.h),
        y: to_bp(n.v - n.height),
        w: to_bp(n.width),
        h: to_bp(n.height + n.depth),
    }
}

fn dist_to_rect(r: &Rect, x: f64, y: f64) -> f64 {
    let dx = if x < r.x {
        r.x - x
    } else if x > r.x + r.w {
        x - (r.x + r.w)
    } else {
        0.0
    };
    let dy = if y < r.y {
        r.y - y
    } else if y > r.y + r.h {
        y - (r.y + r.h)
    } else {
        0.0
    };
    (dx * dx + dy * dy).sqrt()
}

#[derive(Debug, PartialEq)]
pub enum ParseError {
    Io(String),
}

/// A parsed `.synctex` file: the `Input:` table (file tag -> path, as
/// SyncTeX wrote it) plus a flat list of position records. Real SyncTeX
/// readers track full box nesting to resolve the *innermost containing
/// box*; this M0 version instead finds the nearest record by distance,
/// which is simpler and good enough for a spike -- revisit if inverse
/// sync feels imprecise once wired to the UI (0.7).
pub struct SyncTex {
    files: HashMap<u32, String>,
    nodes: Vec<Node>,
    page_heights: HashMap<u32, f64>,
}

impl SyncTex {
    pub fn parse_gz(gz_bytes: &[u8]) -> Result<Self, ParseError> {
        let mut decoder = flate2::read::GzDecoder::new(gz_bytes);
        let mut text = String::new();
        decoder
            .read_to_string(&mut text)
            .map_err(|e| ParseError::Io(e.to_string()))?;
        Ok(Self::parse_str(&text))
    }

    pub fn parse_str(text: &str) -> Self {
        let mut files = HashMap::new();
        let mut nodes: Vec<Node> = Vec::new();
        let mut current_page: Option<u32> = None;

        for line in text.lines() {
            if line.is_empty() || line.starts_with('!') {
                // `!<n>` lines are byte-offset anchors for fast backward
                // seeking in a real SyncTeX reader; not needed here.
                continue;
            }

            if let Some(rest) = line.strip_prefix("Input:") {
                if let Some((tag_str, path)) = rest.split_once(':') {
                    if let Ok(tag) = tag_str.parse::<u32>() {
                        files.insert(tag, path.to_string());
                    }
                }
                continue;
            }

            if let Some(rest) = line.strip_prefix('{') {
                current_page = rest.parse::<u32>().ok();
                continue;
            }
            if line.starts_with('}') {
                current_page = None;
                continue;
            }
            if line == "Postamble:" {
                break;
            }

            let Some(page) = current_page else { continue };
            if let Some(node) = parse_node_line(line, page) {
                nodes.push(node);
            }
        }

        let mut page_heights = HashMap::new();
        for n in &nodes {
            let bottom = (n.v + n.depth) as f64 / SP_PER_BIGPT;
            let entry = page_heights.entry(n.page).or_insert(0.0);
            if bottom > *entry {
                *entry = bottom;
            }
        }

        SyncTex {
            files,
            nodes,
            page_heights,
        }
    }

    /// Source position -> PDF rects. Multiple rects can come back for one
    /// line (e.g. a line that wraps, or several separate runs on it).
    pub fn forward_sync(&self, file_tag: u32, line: u32) -> (Vec<Rect>, Confidence) {
        let rects: Vec<Rect> = self
            .nodes
            .iter()
            .filter(|n| n.tag == file_tag && n.line == line)
            .map(node_rect)
            .collect();

        let confidence = self.confidence_for(&rects);
        (rects, confidence)
    }

    /// PDF point -> nearest source position on that page. Only considers
    /// leaf records (h/v/k/g), not box containers: containers (a
    /// paragraph's enclosing vbox, the page's outer box, ...) are tagged
    /// with whatever line *closes* them, often the document's last line,
    /// and being large they'd "contain" almost any click -- which without
    /// this filter made nearly every click resolve to the last line
    /// instead of wherever was actually clicked.
    pub fn inverse_sync(&self, page: u32, x: f64, y: f64) -> Option<(u32, u32, Confidence)> {
        let (node, rect) = self
            .nodes
            .iter()
            .filter(|n| n.page == page && !n.is_container)
            .map(|n| (n, node_rect(n)))
            .min_by(|(_, a), (_, b)| {
                dist_to_rect(a, x, y)
                    .partial_cmp(&dist_to_rect(b, x, y))
                    .unwrap_or(std::cmp::Ordering::Equal)
                    .then_with(|| {
                        (a.w * a.h)
                            .partial_cmp(&(b.w * b.h))
                            .unwrap_or(std::cmp::Ordering::Equal)
                    })
            })?;

        let confidence = self.confidence_for(std::slice::from_ref(&rect));
        Some((node.tag, node.line, confidence))
    }

    fn confidence_for(&self, rects: &[Rect]) -> Confidence {
        for r in rects {
            let page_height = self.page_heights.get(&r.page).copied().unwrap_or(0.0);
            if page_height > 0.0 && r.h > 0.4 * page_height {
                return Confidence::Low;
            }
        }
        Confidence::High
    }

    /// The raw `Input:` path for a tag, before path-quirk normalization.
    pub fn raw_input_path(&self, tag: u32) -> Option<&str> {
        self.files.get(&tag).filter(|p| !p.is_empty()).map(|s| s.as_str())
    }

    /// Resolves a tag's `Input:` path against `search_dir`, applying the
    /// Tectonic SyncTeX quirk: `\input{foo}` with no extension can come
    /// back as `foo` rather than `foo.tex`. When the raw path has no
    /// extension and nothing exists at that exact path, try `<path>.tex`
    /// before giving up.
    pub fn resolve_path(&self, tag: u32, search_dir: &Path) -> Option<PathBuf> {
        let raw = self.raw_input_path(tag)?;
        Some(normalize_input_path(raw, search_dir))
    }

    /// The inverse of [`Self::resolve_path`]: given a file (e.g. the
    /// shadow-dir copy of whichever file the editor currently has open),
    /// find its tag. Needed because a project's actual content almost
    /// always lives in `\input`/`\subfile`d files, not the root document
    /// itself, and each gets its own tag -- there's no single fixed "the"
    /// tag once a project has more than one file.
    pub fn tag_for_path(&self, target: &Path, search_dir: &Path) -> Option<u32> {
        let target = target.canonicalize().unwrap_or_else(|_| target.to_path_buf());
        self.files.keys().find_map(|&tag| {
            let resolved = self.resolve_path(tag, search_dir)?;
            let resolved = resolved.canonicalize().unwrap_or(resolved);
            (resolved == target).then_some(tag)
        })
    }
}

fn normalize_input_path(raw: &str, search_dir: &Path) -> PathBuf {
    let candidate = search_dir.join(raw);
    if candidate.extension().is_none() && !candidate.exists() {
        let with_ext = search_dir.join(format!("{raw}.tex"));
        if with_ext.exists() {
            return with_ext;
        }
    }
    candidate
}

fn parse_node_line(line: &str, page: u32) -> Option<Node> {
    let mut chars = line.chars();
    let kind = chars.next()?;
    if !matches!(kind, '[' | ']' | '(' | ')' | 'h' | 'v' | 'k' | 'g') {
        return None;
    }

    let rest = &line[kind.len_utf8()..];
    if rest.is_empty() {
        // bare box-end marker ("]" or ")"), no position data
        return None;
    }

    let (head, tail) = rest.split_once(':')?;
    let (tag_str, line_str) = head.split_once(',')?;
    let tag: u32 = tag_str.parse().ok()?;
    let line_no: u32 = line_str.parse().ok()?;

    let mut parts = tail.splitn(2, ':');
    let hv = parts.next()?;
    let (h_str, v_str) = hv.split_once(',')?;
    let h: i64 = h_str.parse().ok()?;
    let v: i64 = v_str.parse().ok()?;

    let (width, height, depth) = match parts.next() {
        None => (0, 0, 0),
        Some(dims) => {
            let nums: Vec<&str> = dims.split(',').collect();
            match nums.len() {
                1 => (nums[0].parse().ok()?, 0, 0),
                3 => (
                    nums[0].parse().ok()?,
                    nums[1].parse().ok()?,
                    nums[2].parse().ok()?,
                ),
                _ => return None,
            }
        }
    };

    Some(Node {
        page,
        tag,
        line: line_no,
        h,
        v,
        width,
        height,
        depth,
        is_container: matches!(kind, '[' | '('),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn path_quirk_appends_tex_extension_when_needed() {
        let dir = std::env::temp_dir().join(format!(
            "quire-synctex-quirk-test-{}",
            std::process::id()
        ));
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("part.tex"), "content").unwrap();

        // "part" (no extension) should resolve to part.tex since part.tex
        // exists and bare "part" doesn't.
        assert_eq!(
            normalize_input_path("part", &dir),
            dir.join("part.tex")
        );

        // A path that already has an extension is left alone even if it
        // doesn't exist.
        assert_eq!(
            normalize_input_path("figures/plot.png", &dir),
            dir.join("figures/plot.png")
        );

        // No extension, and no <path>.tex exists either -> left as-is.
        assert_eq!(
            normalize_input_path("missing", &dir),
            dir.join("missing")
        );

        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn primary_input_exhibits_the_extension_quirk_too() {
        // Ground truth captured from a real Tectonic compile (see
        // tests/fixtures/sample.synctex.txt): the primary in-memory input,
        // internally named "texput.tex", comes back as bare "texput".
        let text = fs::read_to_string(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/tests/fixtures/sample.synctex.txt"
        ))
        .unwrap();
        let parsed = SyncTex::parse_str(&text);
        assert_eq!(parsed.raw_input_path(1), Some("texput"));
    }

    #[test]
    fn tag_for_path_finds_the_tag_matching_a_real_subfiled_chapter() {
        let dir = std::env::temp_dir().join(format!(
            "quire-synctex-tagpath-test-{}",
            std::process::id()
        ));
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("chapter1.tex"), "content").unwrap();
        let chapter_abs = dir.join("chapter1.tex").canonicalize().unwrap();

        // Mirrors real Tectonic output: the root is tag 1 (bare "texput",
        // the extension quirk), a subfiled chapter is a real tag with its
        // full absolute path, as confirmed against a real multi-file
        // compile during the 0.9 gate test.
        let text = format!(
            "SyncTeX Version:1\nInput:1:texput\nInput:7:{}\nOutput:pdf\nContent:\nPostamble:\n",
            chapter_abs.display()
        );
        let parsed = SyncTex::parse_str(&text);

        assert_eq!(parsed.tag_for_path(&dir.join("chapter1.tex"), &dir), Some(7));
        assert_eq!(parsed.tag_for_path(&dir.join("nonexistent.tex"), &dir), None);

        fs::remove_dir_all(&dir).unwrap();
    }
}
