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

// Re-declared, not generated: ts-rs can't export a bare Rust type alias.
export type ProjectId = string;
export type DocUri = string;

export interface CoreApi {
  openProject(r: OpenProjectRequest): Promise<OpenProjectResponse>;
  setRoot(projectId: ProjectId, uri: DocUri): Promise<void>;
  closeProject(projectId: ProjectId): Promise<void>;

  compile(r: CompileRequest): Promise<CompileResponse>;
  cancelCompile(compileId: string): Promise<void>;

  complete(r: CompletionRequest): Promise<CompletionItem[]>;
  outline(projectId: ProjectId, uri: DocUri): Promise<OutlineNode[]>;

  prefetchPackages(projectId: ProjectId): Promise<PrefetchPackagesResponse>;
  bundleStatus(): Promise<BundleStatusResponse>;
  listInstalledPackages(): Promise<InstalledPackage[]>;
  installPackage(name: string): Promise<FetchedPackage>;
  removePackage(name: string): Promise<void>;
  detectSystemTex(): Promise<DetectSystemTexResponse>;

  readFile(uri: DocUri): Promise<string>;
  writeFile(uri: DocUri, text: string): Promise<void>;

  /** Every file/folder under the project directory, nested -- unlike `OpenProjectResponse.files`, not scoped to the LaTeX dependency graph. */
  listProjectTree(projectId: ProjectId): Promise<ExplorerNode[]>;
  createFile(projectId: ProjectId, parentUri: DocUri, name: string): Promise<EntryResponse>;
  createDirectory(projectId: ProjectId, parentUri: DocUri, name: string): Promise<EntryResponse>;
  renameEntry(projectId: ProjectId, uri: DocUri, newName: string): Promise<EntryResponse>;
  moveEntry(projectId: ProjectId, uri: DocUri, newParentUri: DocUri): Promise<EntryResponse>;
  copyEntry(projectId: ProjectId, uri: DocUri, destParentUri: DocUri, newName?: string): Promise<EntryResponse>;

  searchProject(r: SearchProjectRequest): Promise<SearchProjectResponse>;
  replaceInProject(r: ReplaceInProjectRequest): Promise<ReplaceInProjectResponse>;

  /** Returns an unsubscribe function. */
  onEvent(handler: (e: CoreEvent) => void): () => void;
}
