import type {
  BundleStatusResponse,
  CompileRequest,
  CompileResponse,
  CompletionItem,
  CompletionRequest,
  CoreEvent,
  DetectSystemTexResponse,
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

  searchProject(r: SearchProjectRequest): Promise<SearchProjectResponse>;
  replaceInProject(r: ReplaceInProjectRequest): Promise<ReplaceInProjectResponse>;

  /** Returns an unsubscribe function. */
  onEvent(handler: (e: CoreEvent) => void): () => void;
}
