use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::mpsc::{channel, Receiver, RecvTimeoutError};
use std::time::Duration;

use notify::{Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher as NotifyWatcher};

use super::SKIP_NAMES;

/// Watches a project directory (recursively) and delivers *debounced*
/// batches of changed paths -- a burst of rapid events (an editor's
/// save-as-multiple-syscalls, `git pull` touching many files at once)
/// coalesces into one batch instead of one notification per event.
///
/// Paths under `.git/`, `.quire/`, or `node_modules/` are filtered out
/// before they even reach the debounce buffer. This matters beyond just
/// noise reduction: every compile writes the current buffer into
/// `<project>/.quire/build/` (the shadow dir, see 0.5), and without this
/// exclusion the watcher would see its own writes and trigger another
/// recompile, which writes again, which triggers another watch event --
/// an infinite loop.
pub struct FileWatcher {
    // Held only to keep the OS-level watch alive; never read directly.
    _watcher: RecommendedWatcher,
    batches: Receiver<Vec<PathBuf>>,
}

impl FileWatcher {
    pub fn new(root: &Path, debounce: Duration) -> notify::Result<Self> {
        let (raw_tx, raw_rx) = channel::<PathBuf>();

        let mut watcher = notify::recommended_watcher(move |res: notify::Result<Event>| {
            let Ok(event) = res else { return };
            // Pure access events (a file being read, not written) aren't
            // "changes" worth recompiling over.
            if matches!(event.kind, EventKind::Access(_)) {
                return;
            }
            for path in event.paths {
                if is_excluded(&path) {
                    continue;
                }
                let _ = raw_tx.send(path);
            }
        })?;
        watcher.watch(root, RecursiveMode::Recursive)?;

        let (batch_tx, batch_rx) = channel::<Vec<PathBuf>>();
        std::thread::spawn(move || {
            let mut pending: HashSet<PathBuf> = HashSet::new();
            loop {
                match raw_rx.recv_timeout(debounce) {
                    Ok(path) => {
                        pending.insert(path);
                        // Drain whatever else is already waiting before
                        // going back to (re-)start the quiet-period wait
                        // -- this is what makes it a debounce rather than
                        // a fixed-rate batcher: the window resets on every
                        // new event instead of flushing on a fixed clock.
                        while let Ok(p) = raw_rx.try_recv() {
                            pending.insert(p);
                        }
                    }
                    Err(RecvTimeoutError::Timeout) => {
                        if !pending.is_empty() {
                            let batch: Vec<PathBuf> = pending.drain().collect();
                            if batch_tx.send(batch).is_err() {
                                break; // nobody's listening anymore
                            }
                        }
                    }
                    Err(RecvTimeoutError::Disconnected) => break, // watcher dropped
                }
            }
        });

        Ok(FileWatcher {
            _watcher: watcher,
            batches: batch_rx,
        })
    }

    /// Blocks until a debounced batch of changed paths is ready, or
    /// `timeout` elapses (returning `None`).
    pub fn recv_timeout(&self, timeout: Duration) -> Option<Vec<PathBuf>> {
        self.batches.recv_timeout(timeout).ok()
    }
}

fn is_excluded(path: &Path) -> bool {
    path.components().any(|c| {
        c.as_os_str()
            .to_str()
            .is_some_and(|s| SKIP_NAMES.contains(&s))
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn temp_dir(label: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("quire-watcher-{label}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    // Generous timings: filesystem watchers have real OS-level latency
    // (especially macOS's FSEvents backend), and flaky timing-based tests
    // are worse than slow ones.
    const DEBOUNCE: Duration = Duration::from_millis(100);
    const WAIT: Duration = Duration::from_secs(3);

    #[test]
    fn detects_an_external_write() {
        let dir = temp_dir("basic");
        let watcher = FileWatcher::new(&dir, DEBOUNCE).unwrap();

        fs::write(dir.join("chapter.tex"), "content").unwrap();

        let batch = watcher.recv_timeout(WAIT).expect("expected a debounced batch");
        assert!(
            batch.iter().any(|p| p.ends_with("chapter.tex")),
            "batch was {batch:?}"
        );

        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn rapid_writes_coalesce_into_one_batch() {
        let dir = temp_dir("coalesce");
        let watcher = FileWatcher::new(&dir, DEBOUNCE).unwrap();

        for name in ["a.tex", "b.tex", "c.tex"] {
            fs::write(dir.join(name), "content").unwrap();
        }

        let batch = watcher.recv_timeout(WAIT).expect("expected a debounced batch");
        for name in ["a.tex", "b.tex", "c.tex"] {
            assert!(batch.iter().any(|p| p.ends_with(name)), "missing {name} in {batch:?}");
        }

        // And nothing further shows up -- confirms it was genuinely one
        // coalesced batch, not the first of several.
        assert!(watcher.recv_timeout(Duration::from_millis(500)).is_none());

        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn writes_under_the_shadow_dir_are_not_reported() {
        let dir = temp_dir("shadow-excluded");
        fs::create_dir_all(dir.join(".quire/build")).unwrap();
        let watcher = FileWatcher::new(&dir, DEBOUNCE).unwrap();

        fs::write(dir.join(".quire/build/main.tex"), "shadow copy").unwrap();

        assert!(
            watcher.recv_timeout(Duration::from_millis(500)).is_none(),
            "a write under .quire/ must not be reported (would cause a recompile-loop)"
        );

        fs::remove_dir_all(&dir).unwrap();
    }
}
