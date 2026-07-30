mod file_tracker;
mod rules;

use std::path::Path;

use file_tracker::FileTimeline;

use crate::rpc::{Diagnostic, DiagnosticRange, Position};

/// Every tex pass in `rerun.rs` compiles under this fixed input name regardless of the project's
/// real root filename, so it's the one name in the log that maps back to `root_uri` rather than a
/// project-relative path.
const ROOT_TEX_INPUT_NAME: &str = "texput.tex";

/// Parses one tex pass's full log into structured diagnostics. Callers should pass the *last* tex
/// pass's log, not an intermediate one -- that's what makes "rerun to fix cross-references"
/// resolve itself into silence when a later pass actually fixes it, without this module needing
/// to know anything about the rerun loop itself.
pub fn translate_log(log: &str, root_uri: &str, project_dir: &Path) -> Vec<Diagnostic> {
    let timeline = FileTimeline::build(log);

    rules::detect_all(log)
        .into_iter()
        .map(|hit| {
            let uri = hit.line.map(|_| match timeline.file_at(hit.offset) {
                Some(ROOT_TEX_INPUT_NAME) | None => root_uri.to_string(),
                Some(name) => project_dir.join(name).display().to_string(),
            });
            let range = hit.line.map(|line| {
                let pos = Position { line: line.saturating_sub(1), column: hit.column.unwrap_or(0) };
                DiagnosticRange { start: pos, end: pos }
            });
            Diagnostic {
                uri,
                range,
                severity: hit.severity,
                message: hit.message,
                raw_message: hit.raw_message,
                hint: hit.hint,
                code: Some(hit.code.to_string()),
            }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::rpc::Severity;
    use std::path::PathBuf;

    #[test]
    fn resolves_root_tex_input_name_to_the_real_root_uri() {
        let log = "(texput.tex\n! Missing $ inserted.\n<inserted text> \n                $\nl.3 x^2\n       here\n)";
        let diags = translate_log(log, "/project/main.tex", &PathBuf::from("/project"));
        assert_eq!(diags.len(), 1);
        assert_eq!(diags[0].uri.as_deref(), Some("/project/main.tex"));
        assert_eq!(diags[0].code.as_deref(), Some("missing-dollar"));
    }

    #[test]
    fn resolves_a_subfile_to_a_project_relative_path() {
        let log = "(texput.tex\n(chapters/intro.tex\n! Missing $ inserted.\n<inserted text> \n                $\nl.3 x^2\n       here\n)\n)";
        let diags = translate_log(log, "/project/main.tex", &PathBuf::from("/project"));
        assert_eq!(diags.len(), 1);
        assert_eq!(diags[0].uri.as_deref(), Some("/project/chapters/intro.tex"));
    }

    #[test]
    fn no_location_means_null_uri_and_range() {
        let log = "LaTeX Warning: There were undefined references.\n";
        let diags = translate_log(log, "/project/main.tex", &PathBuf::from("/project"));
        assert_eq!(diags.len(), 1);
        assert_eq!(diags[0].uri, None);
        assert_eq!(diags[0].range, None);
        assert_eq!(diags[0].severity, Severity::Warning);
    }
}
