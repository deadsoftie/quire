const { spawn } = require("node:child_process");
const path = require("node:path");
const readline = require("node:readline");

const SIDECAR_PATH = path.join(__dirname, "..", "..", "..", "target", "debug", "quire-sidecar");

// Wraps `quire-sidecar watch <dir>` -- a long-lived process, unlike the
// compile sidecar's spawn-per-request model, since watching is push-based
// (the OS tells us about changes; we don't poll for them). One of these
// per open project; `stop()` when a different project opens or the app
// quits.
class ProjectWatcher {
  constructor(dir, onChange) {
    this.proc = spawn(SIDECAR_PATH, ["watch", dir], { stdio: ["ignore", "pipe", "inherit"] });

    const rl = readline.createInterface({ input: this.proc.stdout });
    rl.on("line", (line) => {
      if (!line.trim()) return;
      let msg;
      try {
        msg = JSON.parse(line);
      } catch {
        return; // malformed line; not worth crashing the app over
      }
      if (msg.event === "filesChanged") {
        onChange(msg.paths);
      }
    });
  }

  stop() {
    this.proc.kill();
  }
}

module.exports = { ProjectWatcher };
