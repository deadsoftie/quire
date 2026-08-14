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
    Bib,
    Class,
    Package,
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
    /// Plain-English; `null` when versions match or nothing was pinned yet. Never blocks `openProject`.
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

/// `Tectonic` is the default, embedded engine; `System` shells out to a detected TeX Live/MiKTeX install.
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
    /// Client-chosen root override ("targeting"). `quire-core` holds no state, so this travels
    /// with every call like `engine` does; `None`/absent falls through to normal detection.
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub target_root: Option<DocUri>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "kebab-case")]
#[ts(export, export_to = CONTRACT_TS)]
pub enum CompileStatus {
    Ok,
    Errors,
    /// Never produced: the caller kills the process before a response is built.
    Cancelled,
    /// Produced when `CompileRequest.engine` is `"system"` and `system_tex::detect()` finds no working install.
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
    /// Bare package/class names (no extension), populated only when `status` is `"packages-missing"`.
    pub missing_packages: Vec<String>,
    /// The active Tectonic bundle's digest, hex-formatted. Real today; the curated versioned bundle *strategy* doesn't exist yet.
    pub bundle_version: String,
    /// Whichever file this compile actually used as root - the request's `targetRoot` when it
    /// resolved, otherwise whatever automatic detection picked. Always populated; root resolution
    /// happens before any response (including `EngineMissing`) is constructed.
    pub root: DocUri,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = CONTRACT_TS)]
pub struct CancelCompileRequest {
    pub compile_id: String,
}

// ---------- System TeX ----------

/// `xelatex` is preferred (checked first) since Tectonic's own embedded engine is XeTeX-based too.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = CONTRACT_TS)]
pub enum SystemTexEngine {
    Xelatex,
    Pdflatex,
}

/// `engine`/`version` are `None` together iff `available` is `false`.
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
#[serde(
    tag = "kind",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase"
)]
#[ts(export, export_to = CONTRACT_TS)]
pub enum CoreEvent {
    CompileStarted {
        compile_id: String,
    },
    CompileProgress {
        compile_id: String,
        phase: CompilePhase,
        pass: u32,
    },
    CompileFinished {
        result: CompileResponse,
    },
    FilesChanged {
        project_id: ProjectId,
        uris: Vec<DocUri>,
    },
    IndexUpdated {
        project_id: ProjectId,
    },
    BundleFetch {
        package: String,
        bytes: u32,
        done: bool,
    },
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

/// `name` is the package/class name, not a filename. `bytes` is the real downloaded size, known only after the fact.
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

/// `Core` ships in the app and is never removable; `Cache` was fetched on demand and is removable.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = CONTRACT_TS)]
pub enum PackageSource {
    Core,
    Cache,
}

/// `bytes` is `None` for `Core` entries - a fixed app asset, not a meaningful per-package number.
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

// ---------- Explorer ----------
//
// Deliberately separate from `FileNode` above: `FileNode` is (and must stay) the flat,
// LaTeX-graph-reachable list `compile`/export already depend on, not a directory listing.
// `ExplorerNode` is the opposite - every file and folder on disk, nested, for the file
// tree panel.

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = CONTRACT_TS)]
pub enum ExplorerNodeKind {
    File,
    Directory,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = CONTRACT_TS)]
pub struct ExplorerNode {
    pub uri: DocUri,
    pub name: String,
    pub kind: ExplorerNodeKind,
    /// `Some` (possibly empty) for a directory, `None` for a file.
    pub children: Option<Vec<ExplorerNode>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = CONTRACT_TS)]
pub struct ListProjectTreeRequest {
    pub project_id: ProjectId,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = CONTRACT_TS)]
pub struct CreateFileRequest {
    pub project_id: ProjectId,
    pub parent_uri: DocUri,
    pub name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = CONTRACT_TS)]
pub struct CreateDirectoryRequest {
    pub project_id: ProjectId,
    pub parent_uri: DocUri,
    pub name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = CONTRACT_TS)]
pub struct RenameEntryRequest {
    pub project_id: ProjectId,
    pub uri: DocUri,
    pub new_name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = CONTRACT_TS)]
pub struct MoveEntryRequest {
    pub project_id: ProjectId,
    pub uri: DocUri,
    pub new_parent_uri: DocUri,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = CONTRACT_TS)]
pub struct CopyEntryRequest {
    pub project_id: ProjectId,
    pub uri: DocUri,
    pub dest_parent_uri: DocUri,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub new_name: Option<String>,
}

/// Returned by create/rename/move/copy: the entry's resulting absolute path.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = CONTRACT_TS)]
pub struct EntryResponse {
    pub uri: DocUri,
}

// ---------- Search ----------

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = CONTRACT_TS)]
pub struct SearchProjectRequest {
    pub project_id: ProjectId,
    pub query: String,
    pub case_sensitive: bool,
    pub whole_word: bool,
    pub regex: bool,
    pub dirty_buffers: Vec<DirtyBuffer>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = CONTRACT_TS)]
pub struct SearchMatch {
    pub uri: DocUri,
    pub line: u32,
    pub column: u32,
    pub line_text: String,
    pub match_length: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = CONTRACT_TS)]
pub struct SearchProjectResponse {
    pub matches: Vec<SearchMatch>,
    /// True when the match count hit the internal cap - the list isn't exhaustive.
    pub truncated: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = CONTRACT_TS)]
pub struct ReplaceInProjectRequest {
    pub project_id: ProjectId,
    pub query: String,
    pub replacement: String,
    pub case_sensitive: bool,
    pub whole_word: bool,
    pub regex: bool,
    pub dirty_buffers: Vec<DirtyBuffer>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = CONTRACT_TS)]
pub struct ReplacedFile {
    pub uri: DocUri,
    pub replacements: u32,
    /// Full new file content, so the client can refresh an open tab's buffer without a second readFile round trip.
    pub new_text: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = CONTRACT_TS)]
pub struct ReplaceInProjectResponse {
    pub files: Vec<ReplacedFile>,
}
