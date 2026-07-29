import { spawn, type ChildProcess } from "node:child_process";
import * as path from "node:path";
import * as readline from "node:readline";

const SIDECAR_PATH = path.join(__dirname, "..", "..", "..", "target", "debug", "quire-sidecar");

// Wraps `quire-sidecar watch <dir>`, a long-lived process (unlike the compile sidecar's spawn-per-request model) since watching is push-based.
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
