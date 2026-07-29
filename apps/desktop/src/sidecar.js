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
//
// `detached: true` (POSIX) makes the child the leader of its own process
// group, so killing happens via `process.kill(-pid)` (negative PID = the
// whole group) rather than `child.kill()` (that one PID only). This
// matters because Tectonic itself spawns `biber` as a subprocess when
// biblatex needs it (confirmed during the 0.9 gate test) -- SIGKILLing
// only the sidecar would leave biber running as an orphan. Verified
// directly: in one run biber happened to die anyway (likely SIGPIPE from
// its output pipe closing), but that's incidental, not a guarantee --
// "no zombie processes" needs an explicit one.
function runOnce(method, params, cwd) {
  const proc = spawn(SIDECAR_PATH, [], {
    cwd,
    stdio: ["pipe", "pipe", "inherit"],
    detached: process.platform !== "win32",
  });
  let cancelled = false;

  function killProcessTree() {
    if (process.platform !== "win32") {
      try {
        process.kill(-proc.pid, "SIGKILL");
        return;
      } catch {
        // group already gone (e.g. process exited on its own just before
        // this ran) -- fall through to the plain kill as a backstop.
      }
    }
    proc.kill("SIGKILL");
  }

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
      killProcessTree();
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
    // `.finally()` returns a *new* promise that inherits call.promise's
    // rejection -- if we don't catch on it too, a legitimate compile error
    // becomes an unhandled rejection here (a separate promise from the one
    // callers actually await below) and crashes the process.
    call.promise.finally(() => {
      if (this.current === call) this.current = null;
    }).catch(() => {});
    return call.promise;
  }

  // Stateless, independent of compile()'s cancellation: each call spawns
  // its own short-lived process and parses the given synctex blob fresh.
  //
  // `path`+`searchDir` resolve against whichever file is actually open
  // (a project's real content almost always lives in \input/\subfile'd
  // files, not the root document -- each gets its own synctex tag, so
  // there's no single fixed tag once a project has more than one file).
  // Omit them (or pass `tag` directly) for the no-project-open case,
  // where the buffer is always Tectonic's primary input, tag 1.
  forwardSync(synctexBase64, { tag, path, searchDir, line }) {
    return runOnce("forwardSync", { synctexBase64, tag, path, searchDir, line }).promise;
  }

  inverseSync(synctexBase64, page, x, y, searchDir) {
    return runOnce("inverseSync", { synctexBase64, page, x, y, searchDir }).promise;
  }

  // Called from main.js's `will-quit` handler. `detached: true` (above) lets
  // a killed process's group survive independently of this one on purpose --
  // but that same independence means an in-flight compile (and any biber
  // grandchild) would otherwise be orphaned if the app quits without ever
  // calling compile()'s own cancellation path.
  stop() {
    if (this.current) {
      this.current.kill();
      this.current = null;
    }
  }
}

module.exports = { SidecarClient };
