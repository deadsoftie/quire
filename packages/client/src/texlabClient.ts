import { spawn, type ChildProcess } from "node:child_process";

import type { CompletionItem } from "./contract";

// M0/M1 scaffolding only (D7); GPL-3.0, removed once M3 has its own completion index.
const DOC_URI = "file:///quire-buffer.tex";

// Standard LSP framing (Content-Length header), unlike the sidecar's newline-delimited JSON-RPC.
function encode(message: unknown): string {
  const json = JSON.stringify(message);
  return `Content-Length: ${Buffer.byteLength(json, "utf8")}\r\n\r\n${json}`;
}

class LspFrameReader {
  private buffer = Buffer.alloc(0);
  constructor(private onMessage: (msg: unknown) => void) {}

  push(chunk: Buffer) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    for (;;) {
      const headerEnd = this.buffer.indexOf("\r\n\r\n");
      if (headerEnd === -1) return;
      const header = this.buffer.subarray(0, headerEnd).toString("utf8");
      const match = header.match(/Content-Length: (\d+)/i);
      if (!match) return;
      const length = parseInt(match[1], 10);
      const bodyStart = headerEnd + 4;
      if (this.buffer.length < bodyStart + length) return;
      const body = this.buffer.subarray(bodyStart, bodyStart + length).toString("utf8");
      this.buffer = this.buffer.subarray(bodyStart + length);
      try {
        this.onMessage(JSON.parse(body));
      } catch {
        // malformed frame; drop it rather than crash the whole client
      }
    }
  }
}

interface LspCompletionItem {
  label: string;
  detail?: string;
  kind?: number;
}

// Every result here is a LaTeX command in practice (triggered only after `\`); LSP's numeric CompletionItemKind doesn't map cleanly onto our kind union, so this stays honestly "command" until M3's own index.
function mapKind(_lspKind: number | undefined): CompletionItem["kind"] {
  return "command";
}

// One persistent texlab process per app run, kept in sync via didOpen/didChange.
export class TexlabClient {
  private proc: ChildProcess | null = null;
  private nextId = 1;
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  private ready: Promise<boolean> | null = null;
  private openedVersion = 0;

  start(): Promise<boolean> {
    if (this.ready) return this.ready;

    this.ready = new Promise((resolve) => {
      let proc: ChildProcess;
      try {
        proc = spawn("texlab", [], { stdio: ["pipe", "pipe", "inherit"] });
      } catch {
        resolve(false);
        return;
      }

      proc.on("error", () => resolve(false));

      // Reject everything pending rather than leaving it hanging forever.
      proc.on("exit", () => {
        this.proc = null;
        for (const { reject } of this.pending.values()) {
          reject(new Error("texlab exited"));
        }
        this.pending.clear();
      });

      const reader = new LspFrameReader((msg) => this.handleMessage(msg));
      proc.stdout!.on("data", (chunk) => reader.push(chunk));
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

  private handleMessage(msg: unknown) {
    const m = msg as { id?: number; error?: { message: string }; result?: unknown };
    if (m.id !== undefined && this.pending.has(m.id)) {
      const { resolve, reject } = this.pending.get(m.id)!;
      this.pending.delete(m.id);
      if (m.error) reject(new Error(m.error.message));
      else resolve(m.result);
    }
    // Notifications from the server (diagnostics, etc.) are ignored.
  }

  private request(method: string, params: unknown): Promise<unknown> {
    const id = this.nextId++;
    const message = { jsonrpc: "2.0", id, method, params };
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.proc!.stdin!.write(encode(message));
    });
  }

  private notify(method: string, params: unknown) {
    this.proc!.stdin!.write(encode({ jsonrpc: "2.0", method, params }));
  }

  private async syncDocument(text: string) {
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

  // `line`/`character` are 0-indexed, matching CM6/LSP conventions.
  async complete(text: string, line: number, character: number): Promise<CompletionItem[]> {
    const ok = await this.start();
    if (!ok) return [];

    await this.syncDocument(text);

    const result = await this.request("textDocument/completion", {
      textDocument: { uri: DOC_URI },
      position: { line, character },
    }).catch(() => null);

    if (!result) return [];
    const items = (Array.isArray(result) ? result : (result as { items?: LspCompletionItem[] }).items ?? []) as LspCompletionItem[];

    return items.map((item) => ({
      label: item.label,
      kind: mapKind(item.kind),
      insert: item.label,
      detail: item.detail,
      sortPriority: 0,
    }));
  }

  stop() {
    this.proc?.kill();
  }
}
