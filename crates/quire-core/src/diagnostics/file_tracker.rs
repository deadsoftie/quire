use regex::Regex;

/// Tracks which input file was open at each byte offset in a TeX engine log, by walking the
/// `(filename ... )` push/pop nesting the engine prints as it opens/closes files. A `(` not
/// immediately followed by a recognizable filename is treated as unnamed (font/box notes etc.
/// print plenty of these) and only affects nesting depth, not the current file.
pub struct FileTimeline {
    checkpoints: Vec<(usize, Option<String>)>,
}

impl FileTimeline {
    pub fn build(log: &str) -> Self {
        let filename_re =
            Regex::new(r"^([./]?[\w.\-/]+\.(?:tex|sty|cls|clo|cfg|def|fd|aux|bbl|out|toc|bib))\b").unwrap();

        let mut stack: Vec<(String, u32)> = Vec::new();
        let mut checkpoints = Vec::new();
        let bytes = log.as_bytes();

        for i in 0..bytes.len() {
            match bytes[i] {
                b'(' => {
                    if let Some(m) = filename_re.find(&log[i + 1..]) {
                        let name = m.as_str().to_string();
                        stack.push((name.clone(), 0));
                        checkpoints.push((i, Some(name)));
                    } else if let Some(top) = stack.last_mut() {
                        top.1 += 1;
                    }
                }
                b')' => {
                    if let Some(top) = stack.last_mut() {
                        if top.1 > 0 {
                            top.1 -= 1;
                        } else {
                            stack.pop();
                            checkpoints.push((i, stack.last().map(|(f, _)| f.clone())));
                        }
                    }
                }
                _ => {}
            }
        }

        FileTimeline { checkpoints }
    }

    pub fn file_at(&self, offset: usize) -> Option<&str> {
        let idx = self.checkpoints.partition_point(|(pos, _)| *pos <= offset);
        idx.checked_sub(1).and_then(|i| self.checkpoints[i].1.as_deref())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn single_file_stays_current_throughout() {
        let log = "(texput.tex\nsome text\n! error here\nmore text\n)";
        let timeline = FileTimeline::build(log);
        let error_offset = log.find("! error").unwrap();
        assert_eq!(timeline.file_at(error_offset), Some("texput.tex"));
    }

    #[test]
    fn nested_file_reports_the_innermost_open_one() {
        let log = "(texput.tex\nbefore\n(chapters/intro.tex\n! error in intro\n)\nafter\n)";
        let timeline = FileTimeline::build(log);
        let error_offset = log.find("! error in intro").unwrap();
        assert_eq!(timeline.file_at(error_offset), Some("chapters/intro.tex"));

        let after_offset = log.find("after").unwrap();
        assert_eq!(timeline.file_at(after_offset), Some("texput.tex"));
    }

    #[test]
    fn unnamed_parens_do_not_change_the_current_file() {
        let log = "(texput.tex\n(1.2pt) (see explanation)\n! error\n)";
        let timeline = FileTimeline::build(log);
        let error_offset = log.find("! error").unwrap();
        assert_eq!(timeline.file_at(error_offset), Some("texput.tex"));
    }

    #[test]
    fn returns_none_before_any_file_is_open() {
        let log = "leading noise (texput.tex\n! error\n)";
        let timeline = FileTimeline::build(log);
        assert_eq!(timeline.file_at(0), None);
    }
}
