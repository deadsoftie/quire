import { spawn, type ChildProcess } from "node:child_process";
import * as path from "node:path";
import * as readline from "node:readline";

const SIDECAR_PATH = path.join(__dirname, "..", "..", "..", "target", "debug", "quire-sidecar");

// Wraps `quire-sidecar watch <dir>` -- a long-lived process, unlike the
// compile sidecar's spawn-per-request model, since watching is push-based.
// Ported from `apps/desktop/src/watcher.js` (task 1.3), with one fix:
// the original never closed its `readline.Interface`, which -- found
// while smoke-testing this port standalone under plain Node, outside
// Electron -- keeps the event loop alive indefinitely even after the
// underlying process is killed, so a caller awaiting a clean process exit
// (e.g. a test script, or anything that isn't Electron's own
// `app.quit()`-driven teardown) would hang forever. Closing it explicitly
// in `stop()` fixes that regardless of which kind of host is watching.
export class ProjectWatcher {
  private proc: ChildProcess;
  private rl: readline.Interface;

  constructor(dir: string, onChange: (paths: string[]) => void) {
    this.proc = spawn(SIDECAR_PATH, ["watch", dir], { stdio: ["ignore", "pipe", "inherit"] });

    this.rl = readline.createInterface({ input: this.proc.stdout! });
    this.rl.on("line", (line) => {
      if (!line.trim()) return;
      let msg: { event?: string; paths?: string[] };
      try {
        msg = JSON.parse(line);
      } catch {
        return; // malformed line; not worth crashing the app over
      }
      if (msg.event === "filesChanged" && msg.paths) {
        onChange(msg.paths);
      }
    });
  }

  stop() {
    this.rl.close();
    this.proc.kill();
  }
}
