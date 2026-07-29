import { spawn } from "node:child_process";
import * as path from "node:path";
import * as readline from "node:readline";

// Expects the sidecar binary already built via `cargo build -p quire-sidecar`; packaging it is M4.
const SIDECAR_PATH = path.join(__dirname, "..", "..", "..", "target", "debug", "quire-sidecar");

export interface SidecarCall {
  promise: Promise<unknown>;
  kill(): void;
}

// Spawns one sidecar process, sends one JSON-RPC request, resolves with its result. `detached` + process-group kill (not plain child.kill()): Tectonic shells out to biber/bibtex, and only a group-kill reliably takes both out.
export function runOnce(method: string, params: unknown, cwd?: string): SidecarCall {
  const proc = spawn(SIDECAR_PATH, [], {
    cwd,
    stdio: ["pipe", "pipe", "inherit"],
    detached: process.platform !== "win32",
  });
  let cancelled = false;

  function killProcessTree() {
    if (process.platform !== "win32") {
      try {
        process.kill(-proc.pid!, "SIGKILL");
        return;
      } catch {
        // group already gone -- fall through to the plain kill as a backstop.
      }
    }
    proc.kill("SIGKILL");
  }

  const promise = new Promise<unknown>((resolve, reject) => {
    let settled = false;

    const rl = readline.createInterface({ input: proc.stdout });

    rl.on("line", (line) => {
      if (settled || !line.trim()) return;
      settled = true;
      rl.close();

      let response: { error?: { message: string; data?: { log?: string } }; result?: unknown };
      try {
        response = JSON.parse(line);
      } catch (err) {
        reject(new Error(`bad sidecar response: ${(err as Error).message}`));
        return;
      }

      if (response.error) {
        const log = response.error.data?.log;
        const message = log ? `${response.error.message}\n\n${log}` : response.error.message;
        reject(new Error(message));
      } else {
        resolve(response.result);
      }
    });

    proc.on("error", (err) => {
      if (settled) return;
      settled = true;
      if (!cancelled) reject(err);
    });

    proc.on("exit", () => {
      if (settled) return;
      settled = true;
      if (!cancelled) reject(new Error("sidecar exited before responding"));
    });

    const payload = JSON.stringify({ jsonrpc: "2.0", id: 1, method, params });
    proc.stdin.write(payload + "\n");
    // Without this, the sidecar's stdin-read loop never sees EOF and leaks a zombie process even after answering successfully.
    proc.stdin.end();
  });

  return {
    promise,
    kill() {
      cancelled = true;
      killProcessTree();
    },
  };
}
