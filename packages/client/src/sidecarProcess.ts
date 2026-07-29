import { spawn } from "node:child_process";
import * as path from "node:path";
import * as readline from "node:readline";

// M0/M1: the sidecar binary is expected to already be built via
// `cargo build -p quire-sidecar`. Packaging it alongside the app is a
// later-phase concern (see M4). Ported unchanged from
// `apps/desktop/src/sidecar.js`'s `SIDECAR_PATH` -- `dist/` and `src/`
// sit at the same depth under `packages/client/`, so the relative path
// math is identical whether this runs compiled or not.
const SIDECAR_PATH = path.join(__dirname, "..", "..", "..", "target", "debug", "quire-sidecar");

export interface SidecarCall {
  promise: Promise<unknown>;
  kill(): void;
}

// Spawns one sidecar process, sends one JSON-RPC request, resolves with
// its result (or rejects on error/unexpected exit). Ported from
// `apps/desktop/src/sidecar.js`'s `runOnce` -- see that file's original
// comments (task 1.4) for why `detached: true` + process-group kill is
// used instead of a plain `child.kill()`: Tectonic shells out to `biber`/
// `bibtex` as a subprocess, and only a group-kill reliably takes both out
// together.
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
    // The sidecar's stdin-read loop only terminates on EOF -- found while
    // smoke-testing this port: without this, a sidecar process that
    // *did* answer successfully never exits on its own (it just sits
    // blocked waiting for a next line that never comes), leaking one
    // zombie process per completed request. This bug predates this port
    // (the original `apps/desktop/src/sidecar.js` has the same gap);
    // confirmed by finding dozens of accumulated `quire-sidecar`
    // processes from an already-running, unrelated Electron session
    // while investigating why a standalone smoke test never exited.
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
