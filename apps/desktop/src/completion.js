const { spawn } = require("node:child_process");

// M0/M1 scaffolding only -- see tools/scaffold/texlab/README.md. GPL-3.0,
// never a production dependency, removed in M3 (task 3.12) once
// quire-core has its own completion index.
const DOC_URI = "file:///quire-buffer.tex";

// Standard LSP framing (Content-Length header), distinct from the
// newline-delimited JSON-RPC the compile sidecar speaks.
function encode(message) {
  const json = JSON.stringify(message);
  return `Content-Length: ${Buffer.byteLength(json, "utf8")}\r\n\r\n${json}`;
}

class LspFrameReader {
  constructor(onMessage) {
    this.buffer = Buffer.alloc(0);
    this.onMessage = onMessage;
  }

  push(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    for (;;) {
      const headerEnd = this.buffer.indexOf("\r\n\r\n");
      if (headerEnd === -1) return;
      const header = this.buffer.slice(0, headerEnd).toString("utf8");
      const match = header.match(/Content-Length: (\d+)/i);
      if (!match) return;
      const length = parseInt(match[1], 10);
      const bodyStart = headerEnd + 4;
      if (this.buffer.length < bodyStart + length) return;
      const body = this.buffer.slice(bodyStart, bodyStart + length).toString("utf8");
      this.buffer = this.buffer.slice(bodyStart + length);
      try {
        this.onMessage(JSON.parse(body));
      } catch {
        // malformed frame; drop it rather than crash the whole client
      }
    }
  }
}

// One persistent texlab process per app run. Completion isn't cancelled
// or superseded the way compile is -- it's just request/response against
// a session that's kept in sync via didOpen/didChange.
class CompletionClient {
  constructor() {
    this.proc = null;
    this.nextId = 1;
    this.pending = new Map();
    this.ready = null;
    this.openedVersion = 0;
  }

  start() {
    if (this.ready) return this.ready;

    this.ready = new Promise((resolve) => {
      let proc;
      try {
        proc = spawn("texlab", [], { stdio: ["pipe", "pipe", "inherit"] });
      } catch {
        resolve(false);
        return;
      }

      proc.on("error", () => resolve(false));

      const reader = new LspFrameReader((msg) => this.handleMessage(msg));
      proc.stdout.on("data", (chunk) => reader.push(chunk));
      this.proc = proc;

      this.request("initialize", { processId: process.pid, rootUri: null, capabilities: {} }).then(
        () => {
          this.notify("initialized", {});
          resolve(true);
        },
        () => resolve(false),
      );
    });

    return this.ready;
  }

  handleMessage(msg) {
    if (msg.id !== undefined && this.pending.has(msg.id)) {
      const { resolve, reject } = this.pending.get(msg.id);
      this.pending.delete(msg.id);
      if (msg.error) reject(new Error(msg.error.message));
      else resolve(msg.result);
    }
    // Notifications from the server (diagnostics, etc.) are ignored --
    // no diagnostics UI in this M0 spike.
  }

  request(method, params) {
    const id = this.nextId++;
    const message = { jsonrpc: "2.0", id, method, params };
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.proc.stdin.write(encode(message));
    });
  }

  notify(method, params) {
    this.proc.stdin.write(encode({ jsonrpc: "2.0", method, params }));
  }

  async syncDocument(text) {
    this.openedVersion += 1;
    if (this.openedVersion === 1) {
      this.notify("textDocument/didOpen", {
        textDocument: { uri: DOC_URI, languageId: "latex", version: 1, text },
      });
    } else {
      this.notify("textDocument/didChange", {
        textDocument: { uri: DOC_URI, version: this.openedVersion },
        contentChanges: [{ text }],
      });
    }
  }

  // `line`/`character` are 0-indexed, matching CM6 and LSP conventions.
  async complete(text, line, character) {
    const ok = await this.start();
    if (!ok) return [];

    await this.syncDocument(text);

    const result = await this.request("textDocument/completion", {
      textDocument: { uri: DOC_URI },
      position: { line, character },
    }).catch(() => null);

    if (!result) return [];
    const items = Array.isArray(result) ? result : result.items ?? [];
    return items.map((item) => ({
      label: item.label,
      detail: item.detail,
      // LSP CompletionItemKind is a number; the exact mapping to CM6's
      // string-based `type` isn't important for a first pass, so this
      // just distinguishes "looks like a command" from everything else.
      kind: item.kind,
    }));
  }

  stop() {
    this.proc?.kill();
  }
}

module.exports = { CompletionClient };
