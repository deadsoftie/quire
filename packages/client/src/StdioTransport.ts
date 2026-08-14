import { randomUUID } from "node:crypto";

import type { CoreApi, DocUri, ProjectId } from "./CoreApi";
import type {
  BundleStatusResponse,
  CompileRequest,
  CompileResponse,
  CompletionItem,
  CompletionRequest,
  CoreEvent,
  DetectSystemTexResponse,
  EntryResponse,
  ExplorerNode,
  FetchedPackage,
  InstalledPackage,
  OpenProjectRequest,
  OpenProjectResponse,
  OutlineNode,
  PrefetchPackagesResponse,
  ReplaceInProjectRequest,
  ReplaceInProjectResponse,
  SearchProjectRequest,
  SearchProjectResponse,
} from "./contract";
import { ProjectWatcher } from "./projectWatcher";
import { runOnce, type SidecarCall } from "./sidecarProcess";

export class StdioTransport implements CoreApi {
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

  // compileId is minted client-side (not by quire-core, which only needs uniqueness internally) so it exists before the sidecar responds, for cancelCompile/compile-started to reference.
  async compile(r: CompileRequest): Promise<CompileResponse> {
    this.currentCompile?.call.kill();
    this.currentCompile = null;

    const compileId = randomUUID();
    this.emit({ kind: "compile-started", compileId });

    const call = runOnce("compile", r);
    this.currentCompile = { compileId, call };
    // .finally()'s returned promise inherits call.promise's rejection; catch it too or it becomes unhandled.
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
  }

  async complete(r: CompletionRequest): Promise<CompletionItem[]> {
    return (await runOnce("complete", r).promise) as CompletionItem[];
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

  async detectSystemTex(): Promise<DetectSystemTexResponse> {
    return (await runOnce("detectSystemTex", null).promise) as DetectSystemTexResponse;
  }

  async listInstalledPackages(): Promise<InstalledPackage[]> {
    return (await runOnce("listInstalledPackages", null).promise) as InstalledPackage[];
  }

  async installPackage(name: string): Promise<FetchedPackage> {
    return (await runOnce("installPackage", { name }).promise) as FetchedPackage;
  }

  async removePackage(name: string): Promise<void> {
    await runOnce("removePackage", { name }).promise;
  }

  async readFile(uri: DocUri): Promise<string> {
    return (await runOnce("readFile", { uri }).promise) as string;
  }

  async writeFile(uri: DocUri, text: string): Promise<void> {
    await runOnce("writeFile", { uri, text }).promise;
  }

  async listProjectTree(projectId: ProjectId): Promise<ExplorerNode[]> {
    return (await runOnce("listProjectTree", { projectId }).promise) as ExplorerNode[];
  }

  async createFile(projectId: ProjectId, parentUri: DocUri, name: string): Promise<EntryResponse> {
    return (await runOnce("createFile", { projectId, parentUri, name }).promise) as EntryResponse;
  }

  async createDirectory(projectId: ProjectId, parentUri: DocUri, name: string): Promise<EntryResponse> {
    return (await runOnce("createDirectory", { projectId, parentUri, name }).promise) as EntryResponse;
  }

  async renameEntry(projectId: ProjectId, uri: DocUri, newName: string): Promise<EntryResponse> {
    return (await runOnce("renameEntry", { projectId, uri, newName }).promise) as EntryResponse;
  }

  async moveEntry(projectId: ProjectId, uri: DocUri, newParentUri: DocUri): Promise<EntryResponse> {
    return (await runOnce("moveEntry", { projectId, uri, newParentUri }).promise) as EntryResponse;
  }

  async copyEntry(projectId: ProjectId, uri: DocUri, destParentUri: DocUri, newName?: string): Promise<EntryResponse> {
    return (await runOnce("copyEntry", { projectId, uri, destParentUri, newName }).promise) as EntryResponse;
  }

  async searchProject(r: SearchProjectRequest): Promise<SearchProjectResponse> {
    return (await runOnce("searchProject", r).promise) as SearchProjectResponse;
  }

  async replaceInProject(r: ReplaceInProjectRequest): Promise<ReplaceInProjectResponse> {
    return (await runOnce("replaceInProject", r).promise) as ReplaceInProjectResponse;
  }

  onEvent(handler: (e: CoreEvent) => void): () => void {
    this.listeners.add(handler);
    return () => this.listeners.delete(handler);
  }

  /** Not part of {@link CoreApi} - called from `apps/desktop`'s `will-quit` handler. */
  stop() {
    this.currentCompile?.call.kill();
    this.currentCompile = null;
    this.watcher?.stop();
    this.watcher = null;
  }
}
