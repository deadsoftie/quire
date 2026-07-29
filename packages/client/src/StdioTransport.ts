import { randomUUID } from "node:crypto";

import type { CoreApi, DocUri, ProjectId } from "./CoreApi";
import type {
  BundleStatusResponse,
  CompileRequest,
  CompileResponse,
  CompletionItem,
  CompletionRequest,
  CoreEvent,
  OpenProjectRequest,
  OpenProjectResponse,
  OutlineNode,
  PrefetchPackagesResponse,
} from "./contract";
import { ProjectWatcher } from "./projectWatcher";
import { runOnce, type SidecarCall } from "./sidecarProcess";
import { TexlabClient } from "./texlabClient";

/**
 * Desktop's {@link CoreApi} implementation: `quire-sidecar` over stdio
 * (task 1.4's spawn-per-request model) for most methods, plus two things
 * that don't go through it at all -- see `quire-core`'s
 * `rpc::handlers` module docs for why `cancelCompile` and `complete` are
 * transport-layer concerns.
 */
export class StdioTransport implements CoreApi {
  private texlab = new TexlabClient();
  private watcher: ProjectWatcher | null = null;
  private watchedProjectId: ProjectId | null = null;
  private listeners = new Set<(e: CoreEvent) => void>();
  private currentCompile: { compileId: string; call: SidecarCall } | null = null;

  private emit(e: CoreEvent) {
    for (const listener of this.listeners) listener(e);
  }

  async openProject(r: OpenProjectRequest): Promise<OpenProjectResponse> {
    const result = (await runOnce("openProject", r).promise) as OpenProjectResponse;

    this.watcher?.stop();
    this.watchedProjectId = result.projectId;
    this.watcher = new ProjectWatcher(result.projectId, (paths) => {
      this.emit({ kind: "files-changed", projectId: result.projectId, uris: paths });
    });

    return result;
  }

  async setRoot(projectId: ProjectId, uri: DocUri): Promise<void> {
    await runOnce("setRoot", { projectId, uri }).promise;
  }

  async closeProject(projectId: ProjectId): Promise<void> {
    await runOnce("closeProject", { projectId }).promise;
    if (this.watchedProjectId === projectId) {
      this.watcher?.stop();
      this.watcher = null;
      this.watchedProjectId = null;
    }
  }

  // `compileId` has to exist *before* the sidecar responds -- it's how
  // `cancelCompile` finds the right in-flight process, and how a
  // `compile-started` event can carry one at all. `quire-core`'s own
  // handler mints its own id purely for internal uniqueness (nothing on
  // the Rust side ever needs to correlate against it), so this generates
  // one client-side instead and relabels the response with it before
  // anyone sees it -- one real id per compile, known from the start,
  // rather than two that would otherwise silently disagree.
  async compile(r: CompileRequest): Promise<CompileResponse> {
    // Single-flight (1.4): a new compile kills whatever's still running,
    // exactly like the old `SidecarClient.compile()` did.
    this.currentCompile?.call.kill();
    this.currentCompile = null;

    const compileId = randomUUID();
    this.emit({ kind: "compile-started", compileId });

    const call = runOnce("compile", r);
    this.currentCompile = { compileId, call };
    // `.finally()` returns a *new* promise that inherits `call.promise`'s
    // rejection; catch on it too so a legitimate error doesn't become an
    // unhandled rejection on a promise nobody else is holding.
    call.promise
      .finally(() => {
        if (this.currentCompile?.call === call) this.currentCompile = null;
      })
      .catch(() => {});

    const raw = (await call.promise) as CompileResponse;
    const result: CompileResponse = { ...raw, compileId };
    this.emit({ kind: "compile-finished", result });
    return result;
  }

  async cancelCompile(compileId: string): Promise<void> {
    if (this.currentCompile?.compileId === compileId) {
      this.currentCompile.call.kill();
      this.currentCompile = null;
    }
    // Already finished (or never existed) -- nothing to cancel, not an error.
  }

  async complete(r: CompletionRequest): Promise<CompletionItem[]> {
    return this.texlab.complete(r.text, r.position.line, r.position.column);
  }

  async outline(projectId: ProjectId, uri: DocUri): Promise<OutlineNode[]> {
    return (await runOnce("outline", { projectId, uri }).promise) as OutlineNode[];
  }

  async prefetchPackages(projectId: ProjectId): Promise<PrefetchPackagesResponse> {
    return (await runOnce("prefetchPackages", { projectId }).promise) as PrefetchPackagesResponse;
  }

  async bundleStatus(): Promise<BundleStatusResponse> {
    return (await runOnce("bundleStatus", null).promise) as BundleStatusResponse;
  }

  async readFile(uri: DocUri): Promise<string> {
    return (await runOnce("readFile", { uri }).promise) as string;
  }

  async writeFile(uri: DocUri, text: string): Promise<void> {
    await runOnce("writeFile", { uri, text }).promise;
  }

  onEvent(handler: (e: CoreEvent) => void): () => void {
    this.listeners.add(handler);
    return () => this.listeners.delete(handler);
  }

  /** Not part of {@link CoreApi} -- called from `apps/desktop`'s
   * `will-quit` handler, same as the old `SidecarClient.stop()`. */
  stop() {
    this.currentCompile?.call.kill();
    this.currentCompile = null;
    this.watcher?.stop();
    this.watcher = null;
    this.texlab.stop();
  }
}
