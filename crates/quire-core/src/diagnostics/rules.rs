use regex::{Captures, Regex};

use crate::rpc::Severity;

pub struct Hit {
    pub offset: usize,
    pub severity: Severity,
    pub message: String,
    pub raw_message: String,
    pub hint: Option<String>,
    pub code: &'static str,
    pub line: Option<u32>,
    pub column: Option<u32>,
}

enum Location {
    None,
    ForwardScan,
    SameLine(usize),
}

struct Rule {
    code: &'static str,
    severity: Severity,
    pattern: Regex,
    hint: &'static str,
    message: fn(&Captures) -> String,
    location: Location,
}

impl Rule {
    fn find_hits(&self, log: &str) -> Vec<Hit> {
        self.pattern
            .captures_iter(log)
            .map(|caps| {
                let m = caps.get(0).unwrap();
                let (line, column) = match self.location {
                    Location::None => (None, None),
                    Location::ForwardScan => forward_line_marker(log, m.end()).unzip(),
                    Location::SameLine(group) => (caps.get(group).and_then(|g| g.as_str().parse().ok()), None),
                };
                Hit {
                    offset: m.start(),
                    severity: self.severity,
                    message: (self.message)(&caps),
                    raw_message: m.as_str().trim().to_string(),
                    hint: Some(self.hint.to_string()),
                    code: self.code,
                    line,
                    column,
                }
            })
            .collect()
    }
}

/// Finds the next `l.<N> <text>` marker after `from`, how the engine reports where it stopped for most `!` errors.
fn forward_line_marker(log: &str, from: usize) -> Option<(u32, u32)> {
    let re = Regex::new(r"(?m)^l\.(\d+) (.*)$").unwrap();
    let caps = re.captures(&log[from..])?;
    let line: u32 = caps[1].parse().ok()?;
    let column = caps[2].chars().count() as u32;
    Some((line, column))
}

fn simple_rules() -> Vec<Rule> {
    vec![
        Rule {
            code: "missing-dollar",
            severity: Severity::Error,
            pattern: Regex::new(r"! Missing \$ inserted\.").unwrap(),
            message: |_| "Math symbol used outside math mode".to_string(),
            hint: "Wrap it in $...$, or check for an unclosed $ earlier",
            location: Location::ForwardScan,
        },
        Rule {
            code: "runaway-arg",
            severity: Severity::Error,
            pattern: Regex::new(r"! File ended while scanning use of \\(\w+)").unwrap(),
            message: |caps| format!("A {{ was opened for \\{} and never closed", &caps[1]),
            hint: "Points to the opening brace",
            location: Location::ForwardScan,
        },
        Rule {
            code: "env-mismatch",
            severity: Severity::Error,
            pattern: Regex::new(r"! LaTeX Error: \\begin\{(\w+\*?)\} on input line \d+ ended by \\end\{(\w+\*?)\}")
                .unwrap(),
            message: |caps| format!("Environment opened as {}, closed as {}", &caps[1], &caps[2]),
            hint: "Offer to fix either end",
            location: Location::ForwardScan,
        },
        Rule {
            code: "extra-tab",
            severity: Severity::Error,
            pattern: Regex::new(r"! Extra alignment tab has been changed to \\cr\.").unwrap(),
            message: |_| "Row has more & columns than the table declares".to_string(),
            hint: "Show the declared column count",
            location: Location::ForwardScan,
        },
        Rule {
            code: "misplaced-alignment-tab",
            severity: Severity::Error,
            pattern: Regex::new(r"! Misplaced alignment tab character &\.").unwrap(),
            message: |_| "& used outside a table or array".to_string(),
            hint: "& is only valid inside tabular/array-style environments",
            location: Location::ForwardScan,
        },
        Rule {
            code: "bad-delimiter",
            severity: Severity::Error,
            pattern: Regex::new(r"! Missing \\right\. inserted\.").unwrap(),
            message: |_| "\\left is missing its matching \\right".to_string(),
            hint: "Add the matching \\right (or \\right. for none)",
            location: Location::ForwardScan,
        },
        Rule {
            code: "missing-item",
            severity: Severity::Error,
            pattern: Regex::new(r"! LaTeX Error: Something's wrong--perhaps a missing \\item\.").unwrap(),
            message: |_| "A list environment has content before its first \\item".to_string(),
            hint: "Add \\item before the content, or remove it",
            location: Location::ForwardScan,
        },
        Rule {
            code: "illegal-unit",
            severity: Severity::Error,
            pattern: Regex::new(r"! Illegal unit of measure \(pt inserted\)\.").unwrap(),
            message: |_| "A length is missing its unit (pt, cm, em, ...)".to_string(),
            hint: "Add a unit after the number",
            location: Location::ForwardScan,
        },
        Rule {
            code: "redefined-command",
            severity: Severity::Error,
            pattern: Regex::new(r"! LaTeX Error: Command \\(\w+) already defined").unwrap(),
            message: |caps| format!("\\{} is already defined", &caps[1]),
            hint: "Use \\renewcommand instead of \\newcommand",
            location: Location::ForwardScan,
        },
        Rule {
            code: "extra-brace",
            severity: Severity::Error,
            pattern: Regex::new(r"! Too many \}'s\.").unwrap(),
            message: |_| "An extra } has no matching opening brace".to_string(),
            hint: "Remove the extra }, or check for a missing { earlier",
            location: Location::ForwardScan,
        },
        Rule {
            code: "missing-close-brace",
            severity: Severity::Error,
            pattern: Regex::new(r"! Missing \} inserted\.").unwrap(),
            message: |_| "A { was opened and never closed".to_string(),
            hint: "Add the missing }",
            location: Location::ForwardScan,
        },
        Rule {
            code: "double-subscript",
            severity: Severity::Error,
            pattern: Regex::new(r"! Double subscript\.").unwrap(),
            message: |_| "Two subscripts (_) in a row on the same base".to_string(),
            hint: "Group the subscript content in braces, e.g. x_{ab}",
            location: Location::ForwardScan,
        },
        Rule {
            code: "double-superscript",
            severity: Severity::Error,
            pattern: Regex::new(r"! Double superscript\.").unwrap(),
            message: |_| "Two superscripts (^) in a row on the same base".to_string(),
            hint: "Group the superscript content in braces, e.g. x^{ab}",
            location: Location::ForwardScan,
        },
        Rule {
            code: "missing-begin-document",
            severity: Severity::Error,
            pattern: Regex::new(r"! LaTeX Error: Missing \\begin\{document\}\.").unwrap(),
            message: |_| "Content appears before \\begin{document}".to_string(),
            hint: "Move preamble-only commands above \\begin{document}",
            location: Location::ForwardScan,
        },
        Rule {
            code: "bad-math-char",
            severity: Severity::Error,
            pattern: Regex::new(r"! You can't use `(.+?)' in math mode").unwrap(),
            message: |caps| format!("{} can't be used in math mode", &caps[1]),
            hint: "Move it outside $...$, or escape it",
            location: Location::ForwardScan,
        },
        Rule {
            code: "dimension-too-large",
            severity: Severity::Error,
            pattern: Regex::new(r"! Dimension too large\.").unwrap(),
            message: |_| "A length is larger than TeX allows (over ~575cm)".to_string(),
            hint: "Use a smaller value",
            location: Location::ForwardScan,
        },
        Rule {
            code: "undefined-environment",
            severity: Severity::Error,
            pattern: Regex::new(r"! LaTeX Error: Environment (\S+) undefined").unwrap(),
            message: |caps| format!("The {} environment isn't defined", &caps[1]),
            hint: "Check spelling, or load the package that defines it",
            location: Location::ForwardScan,
        },
        Rule {
            code: "missing-number",
            severity: Severity::Error,
            pattern: Regex::new(r"! Missing number, treated as zero\.").unwrap(),
            message: |_| "A command expected a number but got something else (treated as 0)".to_string(),
            hint: "Check the argument is a plain number",
            location: Location::ForwardScan,
        },
        Rule {
            code: "undefined-citation",
            severity: Severity::Warning,
            pattern: Regex::new(r"LaTeX Warning: Citation `([^']+)' on page \d+ undefined on input line (\d+)")
                .unwrap(),
            message: |caps| format!("No entry {} in the bibliography", &caps[1]),
            hint: "List near-matching keys from the index",
            location: Location::SameLine(2),
        },
        Rule {
            code: "undefined-reference",
            severity: Severity::Warning,
            pattern: Regex::new(r"LaTeX Warning: Reference `([^']+)' on page \d+ undefined on input line (\d+)")
                .unwrap(),
            message: |caps| format!("No \\label{{{}}} anywhere in the project", &caps[1]),
            hint: "List near-matching labels",
            location: Location::SameLine(2),
        },
        Rule {
            code: "rerun-needed",
            severity: Severity::Warning,
            pattern: Regex::new(r"LaTeX Warning: There were undefined references\.").unwrap(),
            message: |_| "Cross-references need another pass".to_string(),
            hint: "Usually self-resolving - suppress unless it persists",
            location: Location::None,
        },
    ]
}

/// The undefined command's name lives on the following `l.N <command>` marker, not the trigger line.
fn undefined_command_rule(log: &str) -> Vec<Hit> {
    let trigger = Regex::new(r"! Undefined control sequence\.").unwrap();
    let name_re = Regex::new(r"\\(\w+)\s*$").unwrap();
    trigger
        .find_iter(log)
        .filter_map(|m| {
            let rest = &log[m.end()..];
            let marker = Regex::new(r"(?m)^l\.(\d+) (.*)$").unwrap().captures(rest)?;
            let line: u32 = marker[1].parse().ok()?;
            let before = &marker[2];
            let name = name_re.captures(before).map(|c| c[1].to_string())?;
            Some(Hit {
                offset: m.start(),
                severity: Severity::Error,
                message: format!("\\{name} isn't a command LaTeX knows"),
                raw_message: m.as_str().trim().to_string(),
                hint: Some("Check spelling, or load the package that defines it".to_string()),
                code: "undefined-command",
                line: Some(line),
                column: Some(before.chars().count() as u32),
            })
        })
        .collect()
}

/// `\s+` everywhere a space would be - Tectonic hard-wraps long package names onto their own line.
const MISSING_FILE_PATTERN: &str = r"LaTeX Error:\s+File\s+`([^']+)'\s+not\s+found";

/// Bare names (no extension) of every missing `.sty`/`.cls` mentioned in `log`.
pub fn missing_package_or_class_names(log: &str) -> Vec<String> {
    let trigger = Regex::new(MISSING_FILE_PATTERN).unwrap();
    trigger
        .captures_iter(log)
        .filter_map(|caps| {
            let name = &caps[1];
            name.strip_suffix(".sty").or_else(|| name.strip_suffix(".cls")).map(str::to_string)
        })
        .collect()
}

/// "File 'X' not found" covers package/class/project-file misses, each needing its own code and hint.
fn missing_file_rule(log: &str) -> Vec<Hit> {
    let trigger = Regex::new(MISSING_FILE_PATTERN).unwrap();
    trigger
        .captures_iter(log)
        .map(|caps| {
            let m = caps.get(0).unwrap();
            let name = &caps[1];
            let (code, message, hint) = if name.ends_with(".sty") {
                ("missing-package", format!("The {} package isn't installed", name.trim_end_matches(".sty")), "Offer download when online; name the size")
            } else if name.ends_with(".cls") {
                ("missing-class", format!("The {} document class isn't installed", name.trim_end_matches(".cls")), "Offer download when online; name the size")
            } else {
                ("missing-file", format!("{name} isn't found in this project"), "Check the path, or create the file")
            };
            let (line, column) = forward_line_marker(log, m.end()).unzip();
            Hit {
                offset: m.start(),
                severity: Severity::Error,
                message,
                raw_message: m.as_str().trim().to_string(),
                hint: Some(hint.to_string()),
                code,
                line,
                column,
            }
        })
        .collect()
}

/// Matches both explicit `\hbox to <width>` and ordinary paragraph-breaking overfull shapes.
fn overfull_hbox_rule(log: &str) -> Vec<Hit> {
    let trigger = Regex::new(r"Overfull \\hbox \(([\d.]+)pt too wide\)(?:.*?(?:detected at line (\d+)|in paragraph at lines (\d+)))?").unwrap();
    trigger
        .captures_iter(log)
        .filter_map(|caps| {
            let pt: f64 = caps[1].parse().ok()?;
            if pt < 5.0 {
                return None; // suppressed: overfull boxes under 5pt are noise, not worth surfacing
            }
            let m = caps.get(0).unwrap();
            let line = caps
                .get(2)
                .or_else(|| caps.get(3))
                .and_then(|g| g.as_str().parse().ok());
            Some(Hit {
                offset: m.start(),
                severity: Severity::Warning,
                message: format!("A line runs past the margin by {pt}pt"),
                raw_message: m.as_str().trim().to_string(),
                hint: Some("Warning only. Suppressed under 5pt by default.".to_string()),
                code: "overfull-hbox",
                line,
                column: None,
            })
        })
        .collect()
}

/// Spans two log lines: the shape name on the first, the line number on the second.
fn font_shape_undefined_rule(log: &str) -> Vec<Hit> {
    let trigger = Regex::new(
        r"(?s)LaTeX Font Warning: Font shape `([^']+)' undefined\s*\n\(Font\)\s+using `[^']+' instead on input line (\d+)",
    )
    .unwrap();
    trigger
        .captures_iter(log)
        .map(|caps| {
            let m = caps.get(0).unwrap();
            Hit {
                offset: m.start(),
                severity: Severity::Warning,
                message: format!("Font shape {} isn't available; a substitute was used", &caps[1]),
                raw_message: m.as_str().trim().to_string(),
                hint: Some("Check the font shape name, or load a package that provides it".to_string()),
                code: "font-shape-undefined",
                line: caps[2].parse().ok(),
                column: None,
            }
        })
        .collect()
}

pub fn detect_all(log: &str) -> Vec<Hit> {
    let mut hits: Vec<Hit> = simple_rules().iter().flat_map(|r| r.find_hits(log)).collect();
    hits.extend(undefined_command_rule(log));
    hits.extend(missing_file_rule(log));
    hits.extend(overfull_hbox_rule(log));
    hits.extend(font_shape_undefined_rule(log));
    hits.sort_by_key(|h| h.offset);
    hits
}

#[cfg(test)]
mod tests {
    use super::*;

    fn codes(log: &str) -> Vec<&'static str> {
        detect_all(log).iter().map(|h| h.code).collect()
    }

    #[test]
    fn all_25_plus_named_codes_are_registered() {
        let codes: std::collections::HashSet<&'static str> = simple_rules().iter().map(|r| r.code).collect();
        let all_special = ["undefined-command", "missing-package", "missing-class", "missing-file", "overfull-hbox", "font-shape-undefined"];
        let total = codes.len() + all_special.len();
        assert!(total >= 25, "expected at least 25 distinct codes, got {total}");
    }

    #[test]
    fn overfull_hbox_under_5pt_is_suppressed() {
        let log = "Overfull \\hbox (2.5pt too wide) detected at line 3\n";
        assert!(detect_all(log).is_empty());
    }

    #[test]
    fn overfull_hbox_over_5pt_is_reported() {
        let log = "Overfull \\hbox (12.3pt too wide) detected at line 3\n";
        assert_eq!(codes(log), vec!["overfull-hbox"]);
    }

    #[test]
    fn missing_package_or_class_names_strips_extensions_and_ignores_plain_files() {
        let log = "LaTeX Error: File `tikz.sty' not found\nLaTeX Error: File `beamer.cls' not found\nLaTeX Error: File `figure.png' not found\n";
        assert_eq!(missing_package_or_class_names(log), vec!["tikz", "beamer"]);
    }
}
