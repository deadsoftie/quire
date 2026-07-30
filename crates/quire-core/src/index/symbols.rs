//! Task 3.8: a small, hand-curated math-symbol database for `\alp` -> `\alpha`-style completion.
//! KaTeX does the actual rendering, client-side, from `CompletionItem.symbolPreview`
//! (`packages/ui`); this module only supplies the command names and short descriptions. Unlike
//! 3.5's CTAN commands, these are never scoped by `\usepackage` -- Greek letters and the rest of
//! this starter set are core LaTeX/amsmath, available in essentially every document, so Section
//! 9.4's "project-local > package > global fallback" ranking treats them as the fallback tier
//! itself, not something to gate behind package detection. See `data/README.md` for how the JSON
//! is built and maintained.

use serde::Deserialize;

/// Embedded at compile time, same convention as [`super::ctan`]'s database.
const SYMBOLS_JSON: &str = include_str!("../../data/symbols.json");

#[derive(Deserialize)]
struct RawSymbol {
    name: String,
    detail: String,
}

pub struct MathSymbol {
    /// Without the leading backslash, matching `MacroDef::name`/`CtanCommand::name`'s convention.
    pub name: String,
    pub detail: String,
}

/// Every symbol in the starter set -- always available, never scoped by loaded packages.
pub fn all() -> Vec<MathSymbol> {
    let raw: Vec<RawSymbol> = serde_json::from_str(SYMBOLS_JSON).expect(
        "data/symbols.json must be valid JSON matching RawSymbol's shape -- a build-time asset, not user input, so a parse failure here is a bug in the file itself",
    );
    raw.into_iter().map(|s| MathSymbol { name: s.name, detail: s.detail }).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn embedded_json_parses_and_is_reasonably_shaped() {
        let symbols = all();
        assert!(symbols.iter().any(|s| s.name == "alpha"), "the acceptance criterion's own example must exist: \\alpha");
        for s in &symbols {
            assert!(!s.name.is_empty());
            assert!(!s.name.starts_with('\\'), "{:?} should not include the leading backslash", s.name);
            assert!(!s.detail.is_empty(), "{} has no detail", s.name);
        }
    }

    #[test]
    fn no_duplicate_names() {
        let symbols = all();
        let mut names: Vec<&str> = symbols.iter().map(|s| s.name.as_str()).collect();
        names.sort();
        let before = names.len();
        names.dedup();
        assert_eq!(names.len(), before, "duplicate symbol name in data/symbols.json");
    }
}
