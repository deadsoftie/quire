import { spawn, type ChildProcess } from "node:child_process";
import * as readline from "node:readline";
import { getSidecarPath } from "./sidecarPath";

export class ProjectWatcher {
  private proc: ChildProcess;
  private rl: readline.Interface;
  private stopped = false;

  constructor(dir: string, onChange: (paths: string[]) => void) {
    this.proc = spawn(getSidecarPath(), ["watch", dir], { stdio: ["ignore", "pipe", "inherit"] });

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

    this.proc.on("error", (err) => {
      if (this.stopped) return;
      console.error(`quire-sidecar watch process failed to start or crashed: ${err.message}`);
    });
    this.proc.on("exit", (code, signal) => {
      if (this.stopped) return;
      console.error(`quire-sidecar watch process exited unexpectedly (code ${code}, signal ${signal})`);
    });
  }

  stop() {
    this.stopped = true;
    this.rl.close();
    this.proc.kill();
  }
}
