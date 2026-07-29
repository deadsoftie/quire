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

// `type ProjectId = string` / `type DocUri = string` in QUIRE_SPEC.md
// Section 6 -- re-declared here rather than generated, since `ts-rs` can't
// export a bare Rust type alias (see `crates/quire-core/src/rpc/mod.rs`'s
// module docs for the full reasoning). Structurally these are just
// `string`; the names exist for readability, same as in the spec.
export type ProjectId = string;
export type DocUri = string;

/**
 * QUIRE_SPEC.md Section 6, mirrored field-for-field (task 1.8). Transport-
 * agnostic: {@link StdioTransport} (desktop, today) and a future
 * Capacitor-plugin transport (M5) both implement this same interface, so
 * neither `apps/desktop` nor the shared UI code needs to know which one
 * it's talking to.
 *
 * Two methods the spec lists don't have a `StdioTransport` backed by
 * `quire-sidecar` at all -- see `crates/quire-core/src/rpc/handlers.rs`'s
 * module docs for why `cancelCompile` and `complete` are transport-layer
 * concerns, not `quire-core` ones.
 */
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
