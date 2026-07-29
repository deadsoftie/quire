//! The `CoreApi` contract (task 1.8), matching QUIRE_SPEC.md Section 6
//! field-for-field. This is the single source of truth for every
//! request/response/event shape that crosses the platform boundary:
//! `quire-sidecar` deserializes/serializes these exact types for its
//! JSON-RPC methods (no separate hand-typed param structs), and
//! `packages/client/src/contract.ts` is generated from them via `ts-rs`
//! (see the crate-level `#[ts(export)]` wiring and
//! `.cargo/config.toml`'s `TS_RS_EXPORT_DIR`) -- so the two platforms
//! cannot drift out of sync with each other or with the spec.
//!
//! **Frozen at the end of M1 (task 1.9).** Section 6 covers methods for
//! features that don't exist yet -- `outline` (M3's completion index),
//! `prefetchPackages`/`bundleStatus` (M4's package bundle strategy), and
//! `CoreEvent::IndexUpdated`/`BundleFetch` (same). Per the M1_TASKS.md 1.8
//! decision, those are still defined here with the real shape Section 6
//! specifies -- the wire contract is what's frozen, not full functional
//! coverage -- and their actual handlers (in `quire-sidecar`) honestly
//! report "not implemented yet" rather than faking a result. `SyncTeX`'s
//! `forwardSync`/`inverseSync` are the opposite case and are absent
//! entirely: that feature was cut from v1 scope (see QUIRE_SPEC.md 9.2),
//! so the current Section 6 this module mirrors never mentions them.
//!
//! **Naming/shape judgment calls, since Section 6 doesn't spell out
//! everything:**
//! - `ProjectId`/`DocUri` are plain `String` aliases, not distinct
//!   newtypes -- `ts-rs` can't `#[derive]` on a type alias, and a newtype
//!   wrapper would generate an awkward tuple-shaped TS type instead of a
//!   clean `string`. The semantic distinction is documentation-only, same
//!   as the spec's own `type ProjectId = string` is for engineers, not the
//!   type checker.
//! - `FileNode` (in `OpenProjectResponse.files`) is a flat list derived
//!   from [`crate::project::FileGraph`] (1.1's *LaTeX dependency graph* --
//!   files actually reachable via `\input`/`\include`/`\includegraphics`),
//!   not a general recursive filesystem directory tree. A real file-tree
//!   *browser* (arbitrary nested directories, everything on disk) is a
//!   different, unbuilt feature (M2.5's summoned file-tree panel) --
//!   reusing the already-real, already-tested file graph here is honest
//!   about what actually exists today, not a stand-in for that panel.
//! - `prefetchPackages`/`bundleStatus`'s return types are anonymous inline
//!   object shapes in Section 6 (`Promise<{ fetched: string[]; ... }>`);
//!   `ts-rs` needs a named type to derive from, so they're named
//!   [`PrefetchPackagesResponse`]/[`BundleStatusResponse`] here --
//!   structurally identical to the spec's inline shape, just named.
//! - Every method also gets a named `*Request` struct for its params
//!   (`CloseProjectRequest`, `CancelCompileRequest`, ...), even where
//!   Section 6 shows a positional/simple argument (e.g.
//!   `closeProject(projectId: ProjectId)`) -- our JSON-RPC transport always
//!   sends an object, and a named, `ts-rs`-derived struct for every
//!   request keeps "no hand-written duplication" literal: nothing on the
//!   wire is ever a hand-typed object shape on either side.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

pub mod handlers;

/// Where every contract type's generated TypeScript lands. `ts-rs` merges
/// multiple types that share an `export_to` path into one well-formed file
/// (see `export_and_merge` in the `ts-rs` source) rather than overwriting
/// each other, which is what makes a single combined `contract.ts` --
/// matching Section 6's "mirror it in `packages/client/src/contract.ts`"
/// literally -- possible at all.
const CONTRACT_TS: &str = "contract.ts";

// ---------- Identity ----------

/// `type ProjectId = string;` in Section 6 -- see the module docs for why
/// this is a plain alias, not a `#[derive(TS)]` newtype.
pub type ProjectId = String;

/// `type DocUri = string;` in Section 6 (absolute path on desktop,
/// `bookmark-id://` on iPad once M5 exists). Same reasoning as
/// [`ProjectId`].
pub type DocUri = String;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = CONTRACT_TS)]
pub struct Position {
    /// 0-based.
    pub line: u32,
    /// 0-based, UTF-16 code units (matches CodeMirror/LSP convention).
    pub column: u32,
}

// ---------- Project ----------

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = CONTRACT_TS)]
pub struct OpenProjectRequest {
    pub path: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = CONTRACT_TS)]
pub enum RootConfidence {
    Explicit,
    Inferred,
    Ambiguous,
}

impl From<crate::project::RootConfidence> for RootConfidence {
    fn from(c: crate::project::RootConfidence) -> Self {
        match c {
            crate::project::RootConfidence::Explicit => RootConfidence::Explicit,
            crate::project::RootConfidence::Inferred => RootConfidence::Inferred,
            crate::project::RootConfidence::Ambiguous => RootConfidence::Ambiguous,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = CONTRACT_TS)]
pub enum FileNodeKind {
    Tex,
    Graphic,
}

/// See the module docs: derived from [`crate::project::FileGraph`] (the
/// LaTeX dependency graph), not a general directory walk.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = CONTRACT_TS)]
pub struct FileNode {
    pub uri: DocUri,
    pub name: String,
    pub kind: FileNodeKind,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = CONTRACT_TS)]
pub struct OpenProjectResponse {
    pub project_id: ProjectId,
    /// Detected root document.
    pub root: DocUri,
    pub root_confidence: RootConfidence,
    /// Populated when `rootConfidence` is `"ambiguous"`.
    pub candidates: Vec<DocUri>,
    pub files: Vec<FileNode>,
    pub engine_available: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = CONTRACT_TS)]
pub struct SetRootRequest {
    pub project_id: ProjectId,
    pub uri: DocUri,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = CONTRACT_TS)]
pub struct CloseProjectRequest {
    pub project_id: ProjectId,
}

// ---------- Compile ----------

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = CONTRACT_TS)]
pub struct DirtyBuffer {
    pub uri: DocUri,
    /// Unsaved editor state.
    pub text: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = CONTRACT_TS)]
pub enum CompileReason {
    Edit,
    Manual,
    Open,
    Save,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = CONTRACT_TS)]
pub struct CompileRequest {
    pub project_id: ProjectId,
    pub dirty_buffers: Vec<DirtyBuffer>,
    pub reason: CompileReason,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "kebab-case")]
#[ts(export, export_to = CONTRACT_TS)]
pub enum CompileStatus {
    Ok,
    Errors,
    /// Never produced by `quire-core` today -- cancellation happens by the
    /// caller killing the sidecar process before it responds (1.4's
    /// decision), so a cancelled compile never reaches the point of
    /// constructing a `CompileResponse` at all. Kept in the frozen wire
    /// shape for callers that want to represent "was cancelled" uniformly
    /// alongside a real response, e.g. if a future in-process cancellation
    /// path (M5/M6) ever needs it.
    Cancelled,
    /// Never produced today -- no package-availability detection exists
    /// yet (M4, Section 9.6).
    EngineMissing,
    /// Never produced today, same reason.
    PackagesMissing,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = CONTRACT_TS)]
pub struct CompileResponse {
    pub compile_id: String,
    pub status: CompileStatus,
    /// In the shadow dir. `null` when the compile produced no PDF (an
    /// error before typesetting started, for example).
    pub pdf_path: Option<String>,
    /// For incremental re-render (task 1.7).
    pub changed_pages: Vec<u32>,
    pub page_count: u32,
    pub duration_ms: u32,
    /// Always empty today -- log parsing / plain-English translation is
    /// M3.10 (Section 9.5). A compile error's message still reaches the
    /// caller, just via the JSON-RPC error object, not this list.
    pub diagnostics: Vec<Diagnostic>,
    /// Populated when `status` is `"packages-missing"` -- so always empty
    /// today, since that status is never produced (see [`CompileStatus`]).
    pub missing_packages: Vec<String>,
    /// The active Tectonic bundle's digest, formatted as hex. Real and
    /// meaningful today (every compile already resolves a bundle via
    /// `PersistentConfig::default_bundle`) even though the curated,
    /// versioned bundle *strategy* from Section 9.6 (M4) doesn't exist
    /// yet -- this is "which set of packages was actually used," not
    /// "which named release of quire's own bundle."
    pub bundle_version: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = CONTRACT_TS)]
pub struct CancelCompileRequest {
    pub compile_id: String,
}

// ---------- Events ----------

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = CONTRACT_TS)]
pub enum CompilePhase {
    Typeset,
    Bib,
    Rerun,
}

/// Emitted, not returned -- subscribed to via `onEvent`. `IndexUpdated`
/// and `BundleFetch` are never emitted today: no completion index (M3) or
/// bundle/package-fetch system (M4) exists yet to emit them. Kept in the
/// frozen shape for the same reason as [`CompileStatus`]'s unreachable
/// variants.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(tag = "kind", rename_all = "kebab-case", rename_all_fields = "camelCase")]
#[ts(export, export_to = CONTRACT_TS)]
pub enum CoreEvent {
    CompileStarted { compile_id: String },
    CompileProgress { compile_id: String, phase: CompilePhase, pass: u32 },
    CompileFinished { result: CompileResponse },
    FilesChanged { project_id: ProjectId, uris: Vec<DocUri> },
    IndexUpdated { project_id: ProjectId },
    BundleFetch { package: String, bytes: u32, done: bool },
}

// ---------- Completion ----------

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = CONTRACT_TS)]
pub struct CompletionRequest {
    pub project_id: ProjectId,
    pub uri: DocUri,
    pub position: Position,
    pub text: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = CONTRACT_TS)]
pub enum CompletionKind {
    Command,
    Environment,
    Label,
    Citation,
    Path,
    Package,
    Macro,
    Symbol,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = CONTRACT_TS)]
pub struct CompletionItem {
    pub label: String,
    pub kind: CompletionKind,
    /// May contain `${1:tabstops}`.
    pub insert: String,
    /// e.g. bib entry title, package name.
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub detail: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub documentation: Option<String>,
    /// TeX source for KaTeX rendering, e.g. `"\\alpha"`.
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub symbol_preview: Option<String>,
    /// Lower first.
    pub sort_priority: i32,
}

// ---------- Outline ----------

/// M3 scaffolding -- see the module docs. `outline` never returns anything
/// but an empty list today; this shape is what a real implementation would
/// need to fill in.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = CONTRACT_TS)]
pub enum OutlineNodeKind {
    Part,
    Chapter,
    Section,
    Subsection,
    Subsubsection,
    Label,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = CONTRACT_TS)]
pub struct OutlineNode {
    pub label: String,
    pub kind: OutlineNodeKind,
    pub position: Position,
    pub children: Vec<OutlineNode>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = CONTRACT_TS)]
pub struct OutlineRequest {
    pub project_id: ProjectId,
    pub uri: DocUri,
}

// ---------- Diagnostics ----------

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = CONTRACT_TS)]
pub enum Severity {
    Error,
    Warning,
    Info,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = CONTRACT_TS)]
pub struct DiagnosticRange {
    pub start: Position,
    pub end: Position,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = CONTRACT_TS)]
pub struct Diagnostic {
    /// `null` when the log gives no location.
    pub uri: Option<DocUri>,
    pub range: Option<DiagnosticRange>,
    pub severity: Severity,
    /// PLAIN ENGLISH. Never the raw TeX string.
    pub message: String,
    /// Original, for the detail view.
    pub raw_message: String,
    /// Suggested fix.
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub hint: Option<String>,
    /// Stable id, e.g. `"missing-dollar"`.
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub code: Option<String>,
}

// ---------- Packages ----------

/// M4 scaffolding -- see the module docs.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = CONTRACT_TS)]
pub struct PrefetchPackagesRequest {
    pub project_id: ProjectId,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = CONTRACT_TS)]
pub struct PrefetchPackagesResponse {
    pub fetched: Vec<String>,
    pub failed: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = CONTRACT_TS)]
pub struct BundleStatusResponse {
    pub version: String,
    pub offline_packages: u32,
    pub cache_bytes: u32,
}

// ---------- Files ----------

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = CONTRACT_TS)]
pub struct ReadFileRequest {
    pub uri: DocUri,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = CONTRACT_TS)]
pub struct WriteFileRequest {
    pub uri: DocUri,
    pub text: String,
}
