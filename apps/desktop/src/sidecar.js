const { spawn } = require("node:child_process");
const path = require("node:path");
const readline = require("node:readline");

// M0 spike: the sidecar binary is expected to already be built via
// `cargo build -p quire-sidecar`. Packaging it alongside the app is a
// later-phase concern (see M4).
const SIDECAR_PATH = path.join(__dirname, "..", "..", "..", "target", "debug", "quire-sidecar");

// One process per compile, rather than one long-lived sidecar handling a
// queue of requests. That makes cancellation real: killing the previous
// process actually stops Tectonic mid-run and releases its resources,
// instead of just discarding a stale response once it eventually arrives.
class SidecarClient {
  constructor() {
    this.nextId = 1;
    this.current = null;
  }

  // `cwd`, when given, is the shadow build dir to compile from -- Tectonic
  // resolves \input/\includegraphics against the process's actual working
  // directory, so this is all that's needed for multi-file projects to
  // work. See apps/desktop/src/project.js.
  compile(source, cwd) {
    if (this.current) {
      this.current.cancelled = true;
      this.current.proc.kill("SIGKILL");
      this.current = null;
    }

    const id = this.nextId++;
    const proc = spawn(SIDECAR_PATH, [], { cwd, stdio: ["pipe", "pipe", "inherit"] });
    const state = { proc, cancelled: false };
    this.current = state;

    return new Promise((resolve, reject) => {
      let settled = false;

      const rl = readline.createInterface({ input: proc.stdout });

      rl.on("line", (line) => {
        if (settled || !line.trim()) return;
        settled = true;
        rl.close();
        if (this.current === state) this.current = null;

        let response;
        try {
          response = JSON.parse(line);
        } catch (err) {
          reject(new Error(`bad sidecar response: ${err.message}`));
          return;
        }

        if (response.error) reject(new Error(response.error.message));
        else resolve(response.result);
      });

      proc.on("error", (err) => {
        if (settled) return;
        settled = true;
        if (this.current === state) this.current = null;
        if (!state.cancelled) reject(err);
        // else: killed deliberately by a newer compile() call. Leave this
        // promise permanently pending -- nothing should ever act on it.
      });

      proc.on("exit", () => {
        if (settled) return;
        settled = true;
        if (this.current === state) this.current = null;
        if (!state.cancelled) reject(new Error("sidecar exited before responding"));
      });

      const payload = JSON.stringify({ jsonrpc: "2.0", id, method: "compile", params: { source } });
      proc.stdin.write(payload + "\n");
    });
  }
}

module.exports = { SidecarClient };
