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
    /// Plain-English, ready to display as-is (task 4.6) -- `null` when the project's pinned
    /// bundle version matches the currently active one, or nothing was pinned yet (first open).
    /// A notice only, never blocking: `openProject` still succeeds either way.
    pub bundle_version_notice: Option<String>,
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

/// Task 4.9: `Tectonic` is the default, embedded engine; `System` shells out to a detected
/// TeX Live/MiKTeX install instead. Explicit per request rather than a server-side setting --
/// `quire-core` holds no state (1.4), so every call has to say which engine it wants.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = CONTRACT_TS)]
pub enum CompileEngine {
    Tectonic,
    System,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = CONTRACT_TS)]
pub struct CompileRequest {
    pub project_id: ProjectId,
    pub dirty_buffers: Vec<DirtyBuffer>,
    pub reason: CompileReason,
    pub engine: CompileEngine,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "kebab-case")]
#[ts(export, export_to = CONTRACT_TS)]
pub enum CompileStatus {
    Ok,
    Errors,
    /// Never produced: the caller kills the process before a response is built.
    Cancelled,
    /// Real as of task 4.9: produced when `CompileRequest.engine` is `"system"` and
    /// `system_tex::detect()` finds no working install at compile time.
    EngineMissing,
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
    pub diagnostics: Vec<Diagnostic>,
    /// Bare package/class names (no extension), populated only when `status` is
    /// `"packages-missing"`.
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

// ---------- System TeX ----------

/// Task 4.9: which real, working system engine `system_tex::detect()` found -- `xelatex` is
/// preferred (checked first) over `pdflatex` since Tectonic's own embedded engine is XeTeX-based,
/// so it's the closer match to what the app's users already expect from a compile.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = CONTRACT_TS)]
pub enum SystemTexEngine {
    Xelatex,
    Pdflatex,
}

/// `engine`/`version` are `None` together iff `available` is `false` -- there's no partial state
/// where an engine was found but couldn't be identified.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = CONTRACT_TS)]
pub struct DetectSystemTexResponse {
    pub available: bool,
    pub engine: Option<SystemTexEngine>,
    pub version: Option<String>,
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

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = CONTRACT_TS)]
pub struct PrefetchPackagesRequest {
    pub project_id: ProjectId,
}

/// `name` is the package/class name, not a filename -- what the missing-package UI (task 4.4)
/// shows. `bytes` is the real downloaded size, known only after the fact -- nothing in
/// Tectonic's own bundle API exposes a file's size ahead of fetching it.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = CONTRACT_TS)]
pub struct FetchedPackage {
    pub name: String,
    pub bytes: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = CONTRACT_TS)]
pub struct PrefetchPackagesResponse {
    pub fetched: Vec<FetchedPackage>,
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

/// `Core` ships in the app (task 4.1's curated bundle) and is never removable. `Cache` was
/// fetched on demand and lives in Tectonic's own local cache -- removable, task 4.5's manager
/// panel.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = CONTRACT_TS)]
pub enum PackageSource {
    Core,
    Cache,
}

/// `bytes` is `None` for `Core` entries -- a fixed app asset, not a meaningful per-package number
/// (core is one flat directory of ~50 files shared across many packages' transitive deps, not
/// cleanly attributable one-to-one).
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = CONTRACT_TS)]
pub struct InstalledPackage {
    pub name: String,
    pub bytes: Option<u64>,
    pub source: PackageSource,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = CONTRACT_TS)]
pub struct InstallPackageRequest {
    pub name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = CONTRACT_TS)]
pub struct RemovePackageRequest {
    pub name: String,
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
