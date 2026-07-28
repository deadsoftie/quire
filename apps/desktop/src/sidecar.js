const { spawn } = require("node:child_process");
const path = require("node:path");
const readline = require("node:readline");

// M0 spike: the sidecar binary is expected to already be built via
// `cargo build -p quire-sidecar`. Packaging it alongside the app is a
// later-phase concern (see M4).
const SIDECAR_PATH = path.join(__dirname, "..", "..", "..", "target", "debug", "quire-sidecar");

class SidecarClient {
  constructor() {
    this.nextId = 1;
    this.pending = new Map();

    this.proc = spawn(SIDECAR_PATH, [], { stdio: ["pipe", "pipe", "inherit"] });

    this.proc.on("error", (err) => {
      console.error("[sidecar] failed to start:", err);
    });

    const rl = readline.createInterface({ input: this.proc.stdout });
    rl.on("line", (line) => this.handleLine(line));
  }

  handleLine(line) {
    if (!line.trim()) return;
    let response;
    try {
      response = JSON.parse(line);
    } catch (err) {
      console.error("[sidecar] bad response line:", line);
      return;
    }

    const pending = this.pending.get(response.id);
    if (!pending) return;
    this.pending.delete(response.id);

    if (response.error) {
      pending.reject(new Error(response.error.message));
    } else {
      pending.resolve(response.result);
    }
  }

  request(method, params) {
    const id = this.nextId++;
    const payload = JSON.stringify({ jsonrpc: "2.0", id, method, params });

    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.proc.stdin.write(payload + "\n");
    });
  }

  compile(source) {
    return this.request("compile", { source });
  }
}

module.exports = { SidecarClient };
