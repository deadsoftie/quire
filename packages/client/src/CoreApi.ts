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

// Re-declared, not generated: ts-rs can't export a bare Rust type alias.
export type ProjectId = string;
export type DocUri = string;

/** QUIRE_SPEC.md Section 6, transport-agnostic (StdioTransport today, a Capacitor transport for M5). */
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

  readFile(uri: DocUri): Promise<string>;
  writeFile(uri: DocUri, text: string): Promise<void>;
  /** Returns an unsubscribe function. */
  onEvent(handler: (e: CoreEvent) => void): () => void;
}
