use serde::{Deserialize, Serialize};
use ts_rs::TS;

pub mod handlers;

/// ts-rs merges every type sharing this `export_to` path into one file.
const CONTRACT_TS: &str = "contract.ts";

// ---------- Identity ----------

pub type ProjectId = String;
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

/// Flat list from [`crate::project::FileGraph`] (the LaTeX dependency graph), not a directory walk.
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
    /// Never produced: the caller kills the process before a response is built.
    Cancelled,
    /// Never produced yet -- no package/engine availability detection exists.
    EngineMissing,
    /// Never produced yet, same reason.
    PackagesMissing,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = CONTRACT_TS)]
pub struct CompileResponse {
    pub compile_id: String,
    pub status: CompileStatus,
    /// In the shadow dir; `null` if the compile produced no PDF.
    pub pdf_path: Option<String>,
    pub changed_pages: Vec<u32>,
    pub page_count: u32,
    pub duration_ms: u32,
    /// Always empty today -- log translation isn't implemented yet.
    pub diagnostics: Vec<Diagnostic>,
    /// Populated only when `status` is `"packages-missing"`, so always empty today.
    pub missing_packages: Vec<String>,
    /// The active Tectonic bundle's digest, hex-formatted. Real today; the curated versioned bundle *strategy* doesn't exist yet.
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

/// Emitted via `onEvent`. `IndexUpdated`/`BundleFetch` are never emitted yet.
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

/// `outline` never returns more than an empty list today.
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

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = CONTRACT_TS)]
pub struct DiagnosticRange {
    pub start: Position,
    pub end: Position,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = CONTRACT_TS)]
pub struct Diagnostic {
    /// `null` when the log gives no location.
    pub uri: Option<DocUri>,
    pub range: Option<DiagnosticRange>,
    pub severity: Severity,
    /// PLAIN ENGLISH. Never the raw TeX string.
    pub message: String,
    pub raw_message: String,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub hint: Option<String>,
    /// Stable id, e.g. `"missing-dollar"`.
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub code: Option<String>,
}

// ---------- Packages ----------

/// Not implemented yet.
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
