const { spawn } = require("node:child_process");
const path = require("node:path");
const readline = require("node:readline");

// M0 spike: the sidecar binary is expected to already be built via
// `cargo build -p quire-sidecar`. Packaging it alongside the app is a
// later-phase concern (see M4).
const SIDECAR_PATH = path.join(__dirname, "..", "..", "..", "target", "debug", "quire-sidecar");

// Spawns one sidecar process, sends one JSON-RPC request, resolves with
// its result (or rejects on error/unexpected exit). `onKill` is called if
// the caller cancels via the returned `cancel()` function -- used by
// SidecarClient.compile() for real cancellation; forwardSync/inverseSync
// don't need it, they're cheap, stateless, and never cancelled.
function runOnce(method, params, cwd) {
  const proc = spawn(SIDECAR_PATH, [], { cwd, stdio: ["pipe", "pipe", "inherit"] });
  let cancelled = false;

  const promise = new Promise((resolve, reject) => {
    let settled = false;

    const rl = readline.createInterface({ input: proc.stdout });

    rl.on("line", (line) => {
      if (settled || !line.trim()) return;
      settled = true;
      rl.close();

      let response;
      try {
        response = JSON.parse(line);
      } catch (err) {
        reject(new Error(`bad sidecar response: ${err.message}`));
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
      // else: killed deliberately. Leave this promise permanently pending
      // -- nothing should ever act on a cancelled request's result.
    });

    proc.on("exit", () => {
      if (settled) return;
      settled = true;
      if (!cancelled) reject(new Error("sidecar exited before responding"));
    });

    const payload = JSON.stringify({ jsonrpc: "2.0", id: 1, method, params });
    proc.stdin.write(payload + "\n");
  });

  return {
    promise,
    kill() {
      cancelled = true;
      proc.kill("SIGKILL");
    },
  };
}

// One process per compile, rather than one long-lived sidecar handling a
// queue of requests. That makes cancellation real: killing the previous
// process actually stops Tectonic mid-run and releases its resources,
// instead of just discarding a stale response once it eventually arrives.
class SidecarClient {
  constructor() {
    this.current = null;
  }

  // `cwd`, when given, is the shadow build dir to compile from -- Tectonic
  // resolves \input/\includegraphics against the process's actual working
  // directory, so this is all that's needed for multi-file projects to
  // work. See apps/desktop/src/project.js.
  compile(source, cwd) {
    if (this.current) {
      this.current.kill();
      this.current = null;
    }

    const call = runOnce("compile", { source }, cwd);
    this.current = call;
    call.promise.finally(() => {
      if (this.current === call) this.current = null;
    });
    return call.promise;
  }

  // Stateless, independent of compile()'s cancellation: each call spawns
  // its own short-lived process and parses the given synctex blob fresh.
  forwardSync(synctexBase64, tag, line) {
    return runOnce("forwardSync", { synctexBase64, tag, line }).promise;
  }

  inverseSync(synctexBase64, page, x, y) {
    return runOnce("inverseSync", { synctexBase64, page, x, y }).promise;
  }
}

module.exports = { SidecarClient };
