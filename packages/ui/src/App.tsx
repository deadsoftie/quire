import { useCallback, useEffect, useRef, useState } from "react";
import type {
  CompileReason,
  CompileResponse,
  CoreEvent,
  DetectSystemTexResponse,
  Diagnostic,
  ExplorerNode,
  FileNode,
  OutlineNode,
  ReplacedFile,
  SearchMatch,
} from "@quire/client";
import { FolderPlus, Plus } from "lucide-react";
import { ActivityBar } from "./ActivityBar";
import { CommandPalette } from "./commands/CommandPalette";
import { CommandProvider, useCommand, useCommandRegistrar } from "./commands/CommandContext";
import { Editor } from "./Editor";
import type { EditorHandle } from "./Editor";
import { DEFAULT_DARK_THEME_ID, DEFAULT_LIGHT_THEME_ID, allThemes, applyTheme, normalizeCustomThemes, resolveTheme } from "./theme";
import type { ThemeDefinition } from "./theme";
import { ThemeEditorDialog } from "./ThemeEditorDialog";
import { FindWidget } from "./FindWidget";
import type { FindWidgetHandle } from "./FindWidget";
import { formatLatex } from "./latex/formatter";
import { useMenuBridge } from "./menuBridge";
import { FileTreePanel } from "./panels/FileTreePanel";
import type { FileTreePanelHandle } from "./panels/FileTreePanel";
import { OutlinePanel } from "./panels/OutlinePanel";
import { formatBytes, PackagesPanel } from "./panels/PackagesPanel";
import { ProblemsPanel } from "./panels/ProblemsPanel";
import { collectTexFiles } from "./panels/explorerTree";
import { SearchPanel } from "./panels/SearchPanel";
import { SnippetsPanel } from "./panels/SnippetsPanel";
import type { PanelKind } from "./panels/types";
import { ExportDialog } from "./ExportDialog";
import { toProjectRelativePath } from "./fileDrag";
import { MissingPackagesCard } from "./MissingPackagesCard";
import type { PackageInstallState } from "./MissingPackagesCard";
import { NewProjectDialog } from "./NewProjectDialog";
import { PdfViewer } from "./PdfViewer";
import { Seam } from "./Seam";
import type { SeamState } from "./Seam";
import { SettingsDialog } from "./SettingsDialog";
import { Sidebar } from "./Sidebar";
import { basename } from "./paths";
import { normalizeSession, type SessionState } from "./session";
import { rewriteSingleUri, rewriteTabUris } from "./tabUriRewrite";
import type { CursorPosition, CursorPositionStore } from "./StatusBar";
import { StatusBar } from "./StatusBar";
import { TabBar } from "./TabBar";
import { WelcomeScreen } from "./WelcomeScreen";
import "./App.css";

function createCursorPositionStore(): CursorPositionStore & { set: (position: CursorPosition) => void } {
  let value: CursorPosition | null = null;
  const listeners = new Set<() => void>();
  return {
    set(next) {
      value = next;
      listeners.forEach((listener) => listener());
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot() {
      return value;
    },
  };
}

const SAVE_SESSION_DEBOUNCE_MS = 500;

const DEBOUNCE_MS = 500;

// Duplicated literal (not imported) -- mirrors @quire/client's SIDECAR_CALL_CANCELLED, avoiding CJS/ESM resolution issues across the Electron IPC boundary.
const SIDECAR_CALL_CANCELLED = "sidecar call cancelled";

// A Project only exists after a real openProject() call, so both fields below are always real, never placeholders.
interface Project {
  projectId: string;
  label: string;
  engineAvailable: boolean;
  files: FileNode[];
}

// `text !== savedText` is the tab's entire dirty-state definition, not a separately tracked flag.
interface OpenTab {
  uri: string;
  text: string;
  savedText: string;
  /** CM6 selection head, restored on remount whenever this tab becomes active again. */
  cursor: number;
  scrollTop: number | null;
}

const PANEL_TITLES: Record<PanelKind, string> = {
  "file-tree": "Explorer",
  search: "Search",
  outline: "Outline",
  problems: "Problems",
  packages: "Packages",
  snippets: "Snippets",
};

const DEFAULT_SESSION: SessionState = {
  projectPath: null,
  openTabs: [],
  activeUri: null,
  targetRoot: null,
  sidebarSection: "file-tree",
  sidebarWidth: 240,
  splitFraction: 0.5,
  focusMode: false,
  typewriterMode: false,
  proseMode: false,
  wordWrap: false,
  themeId: DEFAULT_DARK_THEME_ID,
  pdfInverted: false,
  useSystemTex: false,
  cursor: null,
  scrollTop: null,
};

export function App() {
  return (
    <CommandProvider>
      <AppShell />
    </CommandProvider>
  );
}

// Split from App() so useCommand() below has a CommandProvider ancestor.
function AppShell() {
  useMenuBridge();

  const [project, setProject] = useState<Project | null>(null);
  const [explorerTree, setExplorerTree] = useState<ExplorerNode[]>([]);
  // targetRoot is the user's sticky "target this file" choice (Explorer icon/context menu, Export
  // dialog); currentRoot is whichever file the last compile actually used -- the target when it
  // resolved, otherwise whatever automatic detection picked. Two different things: targetRoot can
  // point at something stale (deleted/moved) that compile() silently ignored.
  const [targetRoot, setTargetRoot] = useState<string | null>(null);
  const [currentRoot, setCurrentRoot] = useState<string | null>(null);
  const [tabs, setTabs] = useState<OpenTab[]>([]);
  const [activeUri, setActiveUri] = useState<string | null>(null);
  const [pdfData, setPdfData] = useState<Uint8Array | null>(null);
  const [changedPages, setChangedPages] = useState<number[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [seamState, setSeamState] = useState<SeamState>("idle");
  const [missingPackages, setMissingPackages] = useState<string[] | null>(null);
  const [packageInstallState, setPackageInstallState] = useState<PackageInstallState>("idle");
  const [failedPackageNames, setFailedPackageNames] = useState<string[]>([]);
  const [packagesCacheBytes, setPackagesCacheBytes] = useState(0);
  const [packagesRefreshToken, setPackagesRefreshToken] = useState(0);
  const [bundleVersionNotice, setBundleVersionNotice] = useState<string | null>(null);
  const [splitFraction, setSplitFraction] = useState(0.5);
  const [diagnostics, setDiagnostics] = useState<Diagnostic[]>([]);
  const [compileVersion, setCompileVersion] = useState(0);
  const [sidebarSection, setSidebarSection] = useState<PanelKind | null>("file-tree");
  const [sidebarWidth, setSidebarWidth] = useState(240);
  const [focusMode, setFocusMode] = useState(false);
  const [typewriterMode, setTypewriterMode] = useState(false);
  const [proseMode, setProseMode] = useState(false);
  const [wordWrap, setWordWrap] = useState(false);
  // Seeded from localStorage synchronously so this matches first paint instead of flashing on session load.
  const [themeId, setThemeId] = useState<string>(() => localStorage.getItem("quire-theme-id") ?? DEFAULT_DARK_THEME_ID);
  const [customThemes, setCustomThemes] = useState<ThemeDefinition[]>([]);
  const resolvedTheme = resolveTheme(themeId, customThemes);
  // Non-null while the theme editor dialog is open; `base` seeds the draft, `editingId` is set only when editing an existing custom theme in place.
  const [themeEditor, setThemeEditor] = useState<{ base: ThemeDefinition; editingId: string | null } | null>(null);
  const [pdfInverted, setPdfInverted] = useState(false);
  const [useSystemTex, setUseSystemTex] = useState(false);
  const [systemTexStatus, setSystemTexStatus] = useState<DetectSystemTexResponse | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [newProjectOpen, setNewProjectOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [exportBusy, setExportBusy] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [cursorStore] = useState(() => createCursorPositionStore());

  const projectRef = useRef<Project | null>(null);
  // tabsRef is authoritative and updated outside React state; `tabs` state only exists to repaint the tab bar.
  const tabsRef = useRef<OpenTab[]>([]);
  const editorRef = useRef<EditorHandle>(null);
  const findWidgetRef = useRef<FindWidgetHandle>(null);
  const fileTreeRef = useRef<FileTreePanelHandle>(null);
  // Set only when a diagnostic click targets a file that isn't the active tab; the reveal is deferred to the effect below.
  const pendingRevealRef = useRef<{ uri: string; line: number; column: number } | null>(null);
  const debounceRef = useRef<number | undefined>(undefined);
  const errorTimeoutRef = useRef<number | undefined>(undefined);
  const containerRef = useRef<HTMLDivElement>(null);
  const sessionRef = useRef<SessionState>(DEFAULT_SESSION);
  const saveSessionTimeoutRef = useRef<number | undefined>(undefined);
  // Guards against the save effect below firing before the session-restore effect finishes.
  const initializedRef = useRef(false);
  // Guards the restore effect against StrictMode's dev-only double-invocation.
  const restoreStartedRef = useRef(false);

  const scheduleSaveSession = useCallback(() => {
    if (saveSessionTimeoutRef.current !== undefined) window.clearTimeout(saveSessionTimeoutRef.current);
    saveSessionTimeoutRef.current = window.setTimeout(() => {
      window.quireDesktop.saveSession(sessionRef.current);
    }, SAVE_SESSION_DEBOUNCE_MS);
  }, []);

  const handleCursorActivity = useCallback(
    (cursor: number, scrollTop: number, line: number, column: number) => {
      const idx = tabsRef.current.findIndex((t) => t.uri === activeUri);
      if (idx !== -1) {
        const next = tabsRef.current.slice();
        next[idx] = { ...next[idx], cursor, scrollTop };
        tabsRef.current = next;
      }
      cursorStore.set({ line, column });
      sessionRef.current = { ...sessionRef.current, cursor, scrollTop };
      scheduleSaveSession();
    },
    [activeUri, cursorStore, scheduleSaveSession],
  );

  // Swallows SIDECAR_CALL_CANCELLED (a superseded compile's rejection, not a real error); returns the response for callers that need it.
  // targetRootOverride lets a caller supply the root for this one call directly instead of reading
  // the targetRoot state -- retargetRoot needs this: setTargetRoot() doesn't take effect in this
  // same closure until the next render, so a plain runCompile() called right after it would still
  // send the *previous* target for this one "recompile immediately" call.
  const runCompile = useCallback(
    async (reason: CompileReason, targetRootOverride?: string | null): Promise<CompileResponse | null> => {
      const proj = projectRef.current;
      if (!proj) return null;
      const dirtyBuffers = tabsRef.current.map((t) => ({ uri: t.uri, text: t.text }));
      try {
        const result = await window.quire.compile({
          projectId: proj.projectId,
          dirtyBuffers,
          reason,
          engine: useSystemTex ? "system" : "tectonic",
          targetRoot: targetRootOverride !== undefined ? targetRootOverride : targetRoot,
        });
        setDiagnostics(result.diagnostics);
        // Populated on every status, including failures -- the real current root regardless of
        // whether this particular compile succeeded.
        setCurrentRoot(result.root);
        if (result.status === "ok" && result.pdfPath) {
          const bytes = await window.quireDesktop.readPdfFile(result.pdfPath);
          setPdfData(bytes);
          setChangedPages(result.changedPages);
          setError(null);
          setMissingPackages(null);
          setCompileVersion((v) => v + 1);
        } else if (result.status === "packages-missing") {
          // Not a raw error -- keep whatever PDF is already showing; the card owns this state, not the error box.
          setError(null);
          setMissingPackages(result.missingPackages);
          setPackageInstallState("idle");
          setFailedPackageNames([]);
        } else {
          const diagnostic = result.diagnostics[0];
          setError(diagnostic?.rawMessage || diagnostic?.message || `Compile failed (${result.status}).`);
          setMissingPackages(null);
        }
        return result;
      } catch (err) {
        const message = String((err as Error)?.message ?? err);
        if (message.includes(SIDECAR_CALL_CANCELLED)) return null;
        setError(message);
        return null;
      }
    },
    [useSystemTex, targetRoot],
  );

  // Entry point for "targeting": the Explorer's target icon/context menu (RT.4) and the Export
  // dialog's root picker (RT.5) both call this rather than setting targetRoot directly, so a
  // stale/invalid choice is rejected with a clear, specific error before it ever reaches compile()
  // -- setRoot's own containment + .tex-extension checks (RT.1) are what actually reject it.
  // uri === null clears the target, returning to automatic detection.
  const retargetRoot = useCallback(
    async (uri: string | null) => {
      const proj = projectRef.current;
      if (!proj) return;
      if (uri !== null) {
        try {
          await window.quire.setRoot(proj.projectId, uri);
        } catch (err) {
          setError(String((err as Error)?.message ?? err));
          return;
        }
      }
      setTargetRoot(uri);
      runCompile("manual", uri);
    },
    [runCompile],
  );

  // Best-effort: a prefetch failure just means the first compile falls back to fetching on demand, never blocking the open.
  // targetRootOverride: same reasoning as runCompile's own -- both call sites below reset/restore
  // targetRoot state in the same tick they call this, and that state won't be visible via the
  // targetRoot closure until the next render, so the very first compile after opening a project
  // needs the value passed explicitly rather than read back out of state.
  const prefetchThenCompile = useCallback(
    async (projectId: string, targetRootOverride: string | null) => {
      try {
        await window.quire.prefetchPackages(projectId);
      } catch {
        // See above.
      }
      runCompile("open", targetRootOverride);
    },
    [runCompile],
  );

  // Reuses prefetchPackages wholesale: it re-scans the project for the same commands, so it naturally targets the same missing set.
  const installMissingPackages = useCallback(async () => {
    const proj = projectRef.current;
    if (!proj) return;
    if (!navigator.onLine) {
      setPackageInstallState("offline");
      return;
    }
    setPackageInstallState("installing");
    setSeamState("compiling");
    try {
      const result = await window.quire.prefetchPackages(proj.projectId);
      if (result.failed.length === 0) {
        setMissingPackages(null);
        setPackageInstallState("idle");
        runCompile("edit");
      } else {
        setFailedPackageNames(result.failed);
        setPackageInstallState("offline");
        setSeamState("idle");
      }
    } catch {
      setPackageInstallState("offline");
      setSeamState("idle");
    }
  }, [runCompile]);

  // Real reconnect signal (Chromium's own network-state detection), not a poll.
  useEffect(() => {
    if (packageInstallState !== "offline") return;
    const retry = () => installMissingPackages();
    window.addEventListener("online", retry);
    return () => window.removeEventListener("online", retry);
  }, [packageInstallState, installMissingPackages]);

  // Sidebar caption's cache-size number, fetched only while the packages section is visible.
  useEffect(() => {
    if (sidebarSection !== "packages") return;
    let cancelled = false;
    window.quire.bundleStatus().then((status) => {
      if (!cancelled) setPackagesCacheBytes(status.cacheBytes);
    });
    return () => {
      cancelled = true;
    };
  }, [sidebarSection, packagesRefreshToken]);

  // Checked once at startup, not reactively; self-heals a persisted useSystemTex if the install vanished.
  useEffect(() => {
    let cancelled = false;
    window.quire.detectSystemTex().then((status) => {
      if (cancelled) return;
      setSystemTexStatus(status);
      if (!status.available) setUseSystemTex(false);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const scheduleCompile = useCallback(
    (text: string) => {
      if (!activeUri) return;
      const idx = tabsRef.current.findIndex((t) => t.uri === activeUri);
      if (idx === -1) return;
      const prev = tabsRef.current[idx];
      const wasDirty = prev.text !== prev.savedText;
      const next = tabsRef.current.slice();
      next[idx] = { ...prev, text };
      tabsRef.current = next;
      const isDirty = text !== prev.savedText;
      if (wasDirty !== isDirty) setTabs(next);

      if (debounceRef.current !== undefined) window.clearTimeout(debounceRef.current);
      debounceRef.current = window.setTimeout(() => runCompile("edit"), DEBOUNCE_MS);
    },
    [activeUri, runCompile],
  );

  const openTab = useCallback(
    async (uri: string) => {
      if (tabsRef.current.some((t) => t.uri === uri)) {
        setActiveUri(uri);
        return;
      }
      try {
        const text = await window.quire.readFile(uri);
        const next: OpenTab = { uri, text, savedText: text, cursor: 0, scrollTop: null };
        tabsRef.current = [...tabsRef.current, next];
        setTabs(tabsRef.current);
        setActiveUri(uri);
        runCompile("open");
      } catch (err) {
        setError(String((err as Error)?.message ?? err));
      }
    },
    [runCompile],
  );

  const revealAt = useCallback(
    (uri: string | null | undefined, line: number, column: number) => {
      if (!uri) return;
      if (uri === activeUri) {
        editorRef.current?.revealPosition(line, column);
        return;
      }
      pendingRevealRef.current = { uri, line, column };
      openTab(uri);
    },
    [activeUri, openTab],
  );

  const revealDiagnostic = useCallback(
    (diagnostic: Diagnostic) => revealAt(diagnostic.uri, diagnostic.range?.start.line ?? 0, diagnostic.range?.start.column ?? 0),
    [revealAt],
  );

  const revealSearchMatch = useCallback((match: SearchMatch) => revealAt(match.uri, match.line, match.column), [revealAt]);

  const revealOutlineNode = useCallback(
    (node: OutlineNode) => revealAt(activeUri, node.position.line, node.position.column),
    [revealAt, activeUri],
  );

  const openNewThemeEditor = useCallback(() => {
    setThemeEditor({ base: resolvedTheme, editingId: null });
  }, [resolvedTheme]);

  // Editing a built-in theme duplicates it into a new custom one (editingId stays null); editing an
  // existing custom theme edits it in place.
  const openThemeEditorFor = useCallback((theme: ThemeDefinition) => {
    setThemeEditor({ base: theme, editingId: theme.source === "custom" ? theme.id : null });
  }, []);

  // The dialog drives applyTheme directly for live preview as the user edits; cancelling has to
  // explicitly restore whatever theme was actually active, since nothing else will.
  const cancelThemeEditor = useCallback(() => {
    setThemeEditor(null);
    applyTheme(resolveTheme(themeId, customThemes));
  }, [themeId, customThemes]);

  const saveCustomTheme = useCallback(
    (theme: ThemeDefinition) => {
      const next = customThemes.some((t) => t.id === theme.id)
        ? customThemes.map((t) => (t.id === theme.id ? theme : t))
        : [...customThemes, theme];
      setCustomThemes(next);
      window.quireDesktop.saveThemes(next);
      // Activating what was just saved avoids a separate "now go select it" step.
      setThemeId(theme.id);
      setThemeEditor(null);
    },
    [customThemes],
  );

  const deleteCustomTheme = useCallback(
    (id: string) => {
      const deleted = customThemes.find((t) => t.id === id);
      const next = customThemes.filter((t) => t.id !== id);
      setCustomThemes(next);
      window.quireDesktop.saveThemes(next);
      // Falls back to the matching-appearance Quire default rather than always "dark" -- deleting
      // an active light theme shouldn't silently flip you into a dark one.
      if (themeId === id) setThemeId(deleted?.appearance === "light" ? DEFAULT_LIGHT_THEME_ID : DEFAULT_DARK_THEME_ID);
    },
    [customThemes, themeId],
  );

  // Consumed on the very next activeUri change; a reveal whose openTab failed is simply dropped, never misapplied.
  useEffect(() => {
    const pending = pendingRevealRef.current;
    if (!pending) return;
    pendingRevealRef.current = null;
    if (pending.uri === activeUri) editorRef.current?.revealPosition(pending.line, pending.column);
  }, [activeUri]);

  // Closing the last tab is allowed -- the project stays open with zero tabs, same as "Close All Files".
  const closeTab = useCallback((uri: string) => {
    const current = tabsRef.current;
    const idx = current.findIndex((t) => t.uri === uri);
    if (idx === -1) return;
    const next = current.filter((t) => t.uri !== uri);
    tabsRef.current = next;
    setTabs(next);
    setActiveUri((activePrev) => {
      if (activePrev !== uri) return activePrev;
      const neighbor = current[idx + 1] ?? current[idx - 1];
      return neighbor ? neighbor.uri : null;
    });
  }, []);

  const saveTab = useCallback(
    async (uri: string) => {
      const idx = tabsRef.current.findIndex((t) => t.uri === uri);
      if (idx === -1) return;
      const tab = tabsRef.current[idx];
      const formatted = formatLatex(tab.text);
      if (formatted !== tab.text) {
        const next = tabsRef.current.slice();
        next[idx] = { ...tab, text: formatted };
        tabsRef.current = next;
        // Also sync the live view when this is the mounted tab -- initialDoc only re-seeds on remount.
        if (uri === activeUri) editorRef.current?.replaceContent(formatted);
      }
      const current = tabsRef.current[idx];
      try {
        await window.quire.writeFile(uri, current.text);
        const next = tabsRef.current.slice();
        next[idx] = { ...current, savedText: current.text };
        tabsRef.current = next;
        setTabs(next);
        if (debounceRef.current !== undefined) window.clearTimeout(debounceRef.current);
        runCompile("save");
      } catch (err) {
        setError(String((err as Error)?.message ?? err));
      }
    },
    [runCompile, activeUri],
  );

  const saveAndCloseTab = useCallback(
    async (uri: string) => {
      await saveTab(uri);
      closeTab(uri);
    },
    [saveTab, closeTab],
  );

  // replace_in_project already wrote each file to disk; this only reconciles open tabs so they read as clean.
  const applyReplaceResults = useCallback(
    (files: ReplacedFile[]) => {
      if (files.length === 0) return;
      const byUri = new Map(files.map((f) => [f.uri, f]));
      const next = tabsRef.current.map((t) => {
        const replaced = byUri.get(t.uri);
        if (!replaced) return t;
        if (t.uri === activeUri) editorRef.current?.replaceContent(replaced.newText);
        return { ...t, text: replaced.newText, savedText: replaced.newText };
      });
      tabsRef.current = next;
      setTabs(next);
      runCompile("edit");
    },
    [activeUri, runCompile],
  );

  // Shared batch-confirmation for "Close Folder" and "Close All Files"; returns false on Cancel.
  const confirmAndSaveDirtyTabs = useCallback(async (): Promise<boolean> => {
    const dirty = tabsRef.current.filter((t) => t.text !== t.savedText);
    if (dirty.length === 0) return true;
    const choice = await window.quireDesktop.confirmDiscard(
      dirty.length === 1 ? `Save changes to ${basename(dirty[0].uri)}?` : `Save changes to ${dirty.length} files?`,
    );
    if (choice === "cancel") return false;
    if (choice === "save") {
      for (const t of dirty) await saveTab(t.uri);
    }
    return true;
  }, [saveTab]);

  const applyProject = useCallback((project: Project, tabs: OpenTab[], activeUri: string) => {
    projectRef.current = project;
    setProject(project);
    tabsRef.current = tabs;
    setTabs(tabs);
    setActiveUri(activeUri);
  }, []);

  // Shared by "Open Folder…" and "New Project…" -- once scaffolded, opening it is identical to any other real folder.
  const openProjectAtPath = useCallback(
    async (path: string) => {
      try {
        const opened = await window.quire.openProject({ path });
        const initialText = await window.quire.readFile(opened.root);
        const next: Project = {
          projectId: opened.projectId,
          label: basename(opened.projectId),
          engineAvailable: opened.engineAvailable,
          files: opened.files,
        };
        setBundleVersionNotice(opened.bundleVersionNotice);
        const tab: OpenTab = { uri: opened.root, text: initialText, savedText: initialText, cursor: 0, scrollTop: null };
        applyProject(next, [tab], opened.root);
        setCurrentRoot(opened.root);
        setTargetRoot(null);
        prefetchThenCompile(next.projectId, null);
      } catch (err) {
        setError(String((err as Error)?.message ?? err));
      }
    },
    [applyProject, prefetchThenCompile],
  );

  const openFolderPicker = useCallback(async () => {
    const path = await window.quireDesktop.chooseProjectFolder();
    if (!path) return;
    await openProjectAtPath(path);
  }, [openProjectAtPath]);

  // Shared by the file.new command and the Save As command's native-dialog flow -- the Explorer
  // sidebar's own New File/New Folder buttons use the tree's inline creation instead (see
  // fileTreeRef below), but ⌘N keeps this native picker since it has no tree-focus context to
  // create into.
  const createNewFile = useCallback(async () => {
    if (!project) return;
    const path = await window.quireDesktop.createFile(project.projectId);
    if (!path) return;
    await openTab(path);
  }, [project, openTab]);

  // Whole-directory listing for the Explorer, distinct from `project.files` (the LaTeX-graph
  // subset compile/export use) -- re-fetched wholesale rather than patched incrementally, since a
  // fresh walk is cheap and this sidesteps ever having to reconcile a partial client-side edit.
  const refreshExplorerTree = useCallback(async () => {
    const proj = projectRef.current;
    if (!proj) {
      setExplorerTree([]);
      return;
    }
    try {
      setExplorerTree(await window.quire.listProjectTree(proj.projectId));
    } catch {
      // Transient failure -- leave whatever tree was already showing rather than blanking the Explorer.
    }
  }, []);

  useEffect(() => {
    refreshExplorerTree();
  }, [project, refreshExplorerTree]);

  const createExplorerFile = useCallback(
    async (parentUri: string, name: string) => {
      const proj = projectRef.current;
      if (!proj) return;
      try {
        const created = await window.quire.createFile(proj.projectId, parentUri, name);
        await refreshExplorerTree();
        await openTab(created.uri);
      } catch (err) {
        setError(String((err as Error)?.message ?? err));
      }
    },
    [refreshExplorerTree, openTab],
  );

  const createExplorerDirectory = useCallback(
    async (parentUri: string, name: string) => {
      const proj = projectRef.current;
      if (!proj) return;
      try {
        await window.quire.createDirectory(proj.projectId, parentUri, name);
        await refreshExplorerTree();
      } catch (err) {
        setError(String((err as Error)?.message ?? err));
      }
    },
    [refreshExplorerTree],
  );

  // Rewrites any open tab's uri in place (itself, or nested under a renamed directory) rather than
  // closing and reopening -- that would silently discard unsaved edits and cursor/scroll position.
  // Shared with moveExplorerEntry below: a move is the same kind of uri change as a rename.
  const renameExplorerEntry = useCallback(
    async (uri: string, newName: string): Promise<string | null> => {
      const proj = projectRef.current;
      if (!proj) return null;
      let renamed;
      try {
        renamed = await window.quire.renameEntry(proj.projectId, uri, newName);
      } catch (err) {
        setError(String((err as Error)?.message ?? err));
        return null;
      }
      const { tabs: nextTabs, nextActiveUri } = rewriteTabUris(tabsRef.current, uri, renamed.uri, activeUri);
      tabsRef.current = nextTabs;
      setTabs(nextTabs);
      if (nextActiveUri) setActiveUri(nextActiveUri);
      // The target follows a rename exactly like an open tab already does above -- same rewrite,
      // just applied to a single uri instead of a tab list.
      if (targetRoot) {
        const rewrittenTarget = rewriteSingleUri(targetRoot, uri, renamed.uri);
        if (rewrittenTarget) setTargetRoot(rewrittenTarget);
      }
      await refreshExplorerTree();
      // The renamed path could be the root document or something another file \input{}s -- the
      // preview would otherwise keep showing a now-stale compile until the next edit or the
      // watcher's own debounced files-changed catches up. Every other explicit on-disk mutation in
      // this file (save, open, project-wide replace) already recompiles immediately for the same reason.
      runCompile("edit");
      return renamed.uri;
    },
    [activeUri, targetRoot, refreshExplorerTree, runCompile],
  );

  const moveExplorerEntry = useCallback(
    async (uri: string, newParentUri: string) => {
      const proj = projectRef.current;
      if (!proj) return;
      let moved;
      try {
        moved = await window.quire.moveEntry(proj.projectId, uri, newParentUri);
      } catch (err) {
        setError(String((err as Error)?.message ?? err));
        return;
      }
      const { tabs: nextTabs, nextActiveUri } = rewriteTabUris(tabsRef.current, uri, moved.uri, activeUri);
      tabsRef.current = nextTabs;
      setTabs(nextTabs);
      if (nextActiveUri) setActiveUri(nextActiveUri);
      if (targetRoot) {
        const rewrittenTarget = rewriteSingleUri(targetRoot, uri, moved.uri);
        if (rewrittenTarget) setTargetRoot(rewrittenTarget);
      }
      await refreshExplorerTree();
      runCompile("edit"); // see renameExplorerEntry -- a move changes paths the same way a rename does
    },
    [activeUri, targetRoot, refreshExplorerTree, runCompile],
  );

  // Unlike rename/move, the source is untouched -- no open-tab uri ever needs rewriting here.
  const copyExplorerEntry = useCallback(
    async (uri: string, destParentUri: string) => {
      const proj = projectRef.current;
      if (!proj) return;
      try {
        await window.quire.copyEntry(proj.projectId, uri, destParentUri);
        await refreshExplorerTree();
      } catch (err) {
        setError(String((err as Error)?.message ?? err));
      }
    },
    [refreshExplorerTree],
  );

  const revealExplorerEntry = useCallback(async (uri: string) => {
    try {
      await window.quireDesktop.revealInFileManager(uri);
    } catch (err) {
      setError(String((err as Error)?.message ?? err));
    }
  }, []);

  // OS-trash delete (recoverable), entirely outside CoreApi -- no quire-core involvement at all.
  // Reuses confirmAndSaveDirtyTabs's own one-dialog-for-N-files shape rather than one confirm per tab.
  const trashExplorerEntry = useCallback(
    async (uri: string) => {
      const affected = tabsRef.current.filter((t) => t.uri === uri || t.uri.startsWith(uri + "/"));
      const dirty = affected.filter((t) => t.text !== t.savedText);
      if (dirty.length > 0) {
        const choice = await window.quireDesktop.confirmDiscard(
          dirty.length === 1 ? `Save changes to ${basename(dirty[0].uri)}?` : `Save changes to ${dirty.length} files?`,
        );
        if (choice === "cancel") return;
        if (choice === "save") {
          for (const t of dirty) await saveTab(t.uri);
        }
      }
      try {
        await window.quireDesktop.trashEntry(uri);
      } catch (err) {
        setError(String((err as Error)?.message ?? err));
        return;
      }
      const affectedUris = new Set(affected.map((t) => t.uri));
      const remaining = tabsRef.current.filter((t) => !affectedUris.has(t.uri));
      tabsRef.current = remaining;
      setTabs(remaining);
      if (activeUri && affectedUris.has(activeUri)) {
        setActiveUri(remaining.length > 0 ? remaining[remaining.length - 1].uri : null);
      }
      // The target itself, or its containing directory, just left -- fall back to automatic
      // detection rather than keeping a target that no longer resolves to anything.
      if (targetRoot && (targetRoot === uri || targetRoot.startsWith(uri + "/"))) {
        setTargetRoot(null);
      }
      await refreshExplorerTree();
      runCompile("edit"); // see renameExplorerEntry -- trashing the root or an \input{}-ed file needs a fresh compile too
    },
    [activeUri, targetRoot, saveTab, refreshExplorerTree, runCompile],
  );

  // "manual": a real, user-triggered recompile outside the debounce flow, forced so the exported PDF matches the current editor state.
  const handleExport = useCallback(
    async (includeSource: boolean) => {
      setExportBusy(true);
      setExportError(null);
      const result = await runCompile("manual");
      if (!result || result.status !== "ok" || !result.pdfPath) {
        const diagnostic = result?.diagnostics[0];
        setExportError(diagnostic?.rawMessage || diagnostic?.message || "Compile failed -- fix the errors and try again.");
        setExportBusy(false);
        return;
      }
      const proj = projectRef.current;
      if (!proj) {
        setExportBusy(false);
        return;
      }
      // Open tabs contribute live in-memory text instead of stale disk content, same as compile's dirtyBuffers.
      const sourceFiles = includeSource
        ? proj.files.map((f) => ({ path: f.uri, dirtyText: tabsRef.current.find((t) => t.uri === f.uri)?.text }))
        : undefined;
      try {
        const exported = await window.quireDesktop.exportProject({
          projectDir: proj.projectId,
          pdfPath: result.pdfPath,
          includeSource,
          sourceFiles,
        });
        if (exported) setExportOpen(false);
      } catch (err) {
        setExportError(String((err as Error)?.message ?? err));
      } finally {
        setExportBusy(false);
      }
    },
    [runCompile],
  );

  const closeProject = useCallback(() => {
    projectRef.current = null;
    setProject(null);
    tabsRef.current = [];
    setTabs([]);
    setActiveUri(null);
    setPdfData(null);
    setChangedPages([]);
    setError(null);
    setDiagnostics([]);
    setMissingPackages(null);
    setBundleVersionNotice(null);
    setTargetRoot(null);
    setCurrentRoot(null);
  }, []);

  const createProjectFromSelection = useCallback(
    async (templateId: string | null) => {
      setNewProjectOpen(false);
      const dirPath = await window.quireDesktop.chooseNewProjectFolder();
      if (!dirPath) return;
      try {
        await window.quireDesktop.scaffoldProject(dirPath, templateId);
      } catch (err) {
        setError(String((err as Error)?.message ?? err));
        return;
      }
      await openProjectAtPath(dirPath);
    },
    [openProjectAtPath],
  );

  useEffect(() => {
    if (restoreStartedRef.current) return;
    restoreStartedRef.current = true;
    (async () => {
      const [loaded, loadedThemes] = await Promise.all([window.quireDesktop.loadSession(), window.quireDesktop.loadThemes()]);
      const session = loaded ? normalizeSession(loaded, DEFAULT_SESSION) : null;
      setCustomThemes(normalizeCustomThemes(loadedThemes));

      if (session) {
        setSplitFraction(session.splitFraction);
        setFocusMode(session.focusMode);
        setTypewriterMode(session.typewriterMode);
        setProseMode(session.proseMode);
        setWordWrap(session.wordWrap);
        setThemeId(session.themeId);
        setPdfInverted(session.pdfInverted);
        setUseSystemTex(session.useSystemTex);
        setSidebarSection(session.sidebarSection);
        setSidebarWidth(session.sidebarWidth);
      }

      if (session?.projectPath) {
        try {
          const opened = await window.quire.openProject({ path: session.projectPath });
          const next: Project = {
            projectId: opened.projectId,
            label: basename(opened.projectId),
            engineAvailable: opened.engineAvailable,
            files: opened.files,
          };
          setBundleVersionNotice(opened.bundleVersionNotice);

          // A missing file is skipped, not fatal -- restore whatever's still there instead of falling back to the empty state.
          const wantedUris = session.openTabs.length > 0 ? session.openTabs : [opened.root];
          const loadedTabs: OpenTab[] = [];
          for (const uri of wantedUris) {
            const text = await window.quire.readFile(uri).catch(() => null);
            if (text === null) continue;
            const isActive = uri === session.activeUri;
            loadedTabs.push({
              uri,
              text,
              savedText: text,
              cursor: isActive ? (session.cursor ?? 0) : 0,
              scrollTop: isActive ? session.scrollTop : null,
            });
          }
          // If even the root is unreadable this throws into the outer catch, degrading to the empty state below.
          if (loadedTabs.length === 0) {
            const text = await window.quire.readFile(opened.root);
            loadedTabs.push({ uri: opened.root, text, savedText: text, cursor: 0, scrollTop: null });
          }

          projectRef.current = next;
          setProject(next);
          tabsRef.current = loadedTabs;
          setTabs(loadedTabs);
          const activeStillOpen = loadedTabs.some((t) => t.uri === session.activeUri);
          setActiveUri(activeStillOpen ? session.activeUri : loadedTabs[0].uri);
          setCurrentRoot(opened.root);
          setTargetRoot(session.targetRoot);
          prefetchThenCompile(next.projectId, session.targetRoot);
          initializedRef.current = true;
          return;
        } catch {
          // Path moved/deleted/otherwise unreadable -- fall through to the empty state below, same as a fresh launch.
        }
      }

      // No restorable session, or it didn't pan out -- state stays empty; WelcomeScreen offers Open/New instead.
      initializedRef.current = true;
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    // Skipped while the theme editor is open -- it drives applyTheme directly for live preview,
    // and this effect re-running (e.g. because a Save just changed customThemes) would stomp that.
    if (themeEditor) return;
    applyTheme(resolveTheme(themeId, customThemes));
    localStorage.setItem("quire-theme-id", themeId);
  }, [themeId, customThemes, themeEditor]);

  useEffect(() => {
    if (!initializedRef.current) return;
    sessionRef.current = {
      ...sessionRef.current,
      projectPath: project ? project.projectId : null,
      openTabs: project ? tabs.map((t) => t.uri) : [],
      activeUri: project ? activeUri : null,
      targetRoot: project ? targetRoot : null,
      sidebarSection,
      sidebarWidth,
      splitFraction,
      focusMode,
      typewriterMode,
      proseMode,
      wordWrap,
      themeId,
      pdfInverted,
      useSystemTex,
    };
    scheduleSaveSession();
  }, [
    project,
    tabs,
    activeUri,
    targetRoot,
    sidebarSection,
    sidebarWidth,
    splitFraction,
    focusMode,
    typewriterMode,
    proseMode,
    wordWrap,
    themeId,
    pdfInverted,
    useSystemTex,
    scheduleSaveSession,
  ]);

  // Electron menu items don't reactively bind to renderer state, so this keeps the native View menu's checkboxes in sync.
  useEffect(() => {
    if (!initializedRef.current) return;
    window.quireDesktop.reportViewState({
      "file-tree": sidebarSection === "file-tree",
      search: sidebarSection === "search",
      outline: sidebarSection === "outline",
      problems: sidebarSection === "problems",
      packages: sidebarSection === "packages",
      snippets: sidebarSection === "snippets",
      focusMode,
      typewriterMode,
      proseMode,
      wordWrap,
      themeId,
      pdfInverted,
    });
  }, [sidebarSection, focusMode, typewriterMode, proseMode, wordWrap, themeId, customThemes, pdfInverted]);

  useEffect(() => {
    return window.quire.onEvent((event: CoreEvent) => {
      if (event.kind === "compile-started") {
        if (errorTimeoutRef.current !== undefined) window.clearTimeout(errorTimeoutRef.current);
        setSeamState("compiling");
      } else if (event.kind === "compile-finished") {
        // packages-missing reads as "idle," not "error" -- the card owns that messaging, not a red seam flash.
        if (event.result.status === "ok" || event.result.status === "packages-missing") {
          if (errorTimeoutRef.current !== undefined) window.clearTimeout(errorTimeoutRef.current);
          setSeamState("idle");
        } else {
          setSeamState("error");
          errorTimeoutRef.current = window.setTimeout(() => setSeamState("idle"), 800);
        }
      } else if (event.kind === "files-changed") {
        if (projectRef.current && event.projectId === projectRef.current.projectId) {
          runCompile("edit");
          // External change (git checkout, a script writing output, ...) -- the Explorer has no
          // other way to notice a file appearing/disappearing/moving outside the app's own
          // create/rename/move/copy/trash paths, which already refresh it themselves.
          refreshExplorerTree();
        }
      }
    });
  }, [runCompile, refreshExplorerTree]);

  useCommand({
    id: "project.open",
    title: "Open Folder…",
    shortcut: "⌘O",
    // No keybinding: the File menu's native accelerator dispatches through menuBridge instead.
    run: openFolderPicker,
  });

  useCommand({
    id: "project.new",
    title: "New Project…",
    shortcut: "⇧⌘N",
    // No keybinding: see project.open's comment above.
    run: () => setNewProjectOpen(true),
  });

  useCommand({
    id: "file.new",
    title: "New File",
    shortcut: "⌘N",
    run: createNewFile,
  });

  useCommand({
    id: "file.open",
    title: "Open File…",
    shortcut: "⇧⌘O",
    run: async () => {
      if (!project) return;
      const path = await window.quireDesktop.chooseFile(project.projectId);
      if (!path) return;
      await openTab(path);
    },
  });

  useCommand({
    id: "file.close",
    title: "Close File",
    shortcut: "⌘W",
    run: async () => {
      if (!activeUri) return;
      const tab = tabsRef.current.find((t) => t.uri === activeUri);
      if (!tab) return;
      if (tab.text === tab.savedText) {
        closeTab(activeUri);
        return;
      }
      const choice = await window.quireDesktop.confirmDiscard(`Save changes to ${basename(activeUri)}?`);
      if (choice === "save") await saveAndCloseTab(activeUri);
      else if (choice === "discard") closeTab(activeUri);
    },
  });

  useCommand({
    id: "file.close-all",
    title: "Close All Files",
    shortcut: "⇧⌘W",
    // No keybinding: see project.open's comment above.
    run: async () => {
      if (!(await confirmAndSaveDirtyTabs())) return;
      tabsRef.current = [];
      setTabs([]);
      setActiveUri(null);
    },
  });

  useCommand({
    id: "file.close-folder",
    title: "Close Folder",
    run: async () => {
      if (!(await confirmAndSaveDirtyTabs())) return;
      closeProject();
    },
  });

  useCommand({
    id: "file.save",
    title: "Save",
    shortcut: "⌘S",
    // No keybinding -- see project.open's comment above; the File menu's ⌘S accelerator covers it.
    run: () => {
      if (activeUri) saveTab(activeUri);
    },
  });

  useCommand({
    id: "file.save-as",
    title: "Save As…",
    shortcut: "⇧⌘S",
    run: async () => {
      if (!project || !activeUri) return;
      const path = await window.quireDesktop.createFile(project.projectId);
      if (!path) return;
      const idx = tabsRef.current.findIndex((t) => t.uri === activeUri);
      if (idx === -1) return;
      const tab = tabsRef.current[idx];
      // No live-view push needed here -- the tab's `uri` change below forces an <Editor> remount.
      const formatted = formatLatex(tab.text);
      await window.quire.writeFile(path, formatted);
      const next = tabsRef.current.slice();
      next[idx] = { ...tab, uri: path, text: formatted, savedText: formatted };
      tabsRef.current = next;
      setTabs(next);
      setActiveUri(path);
    },
  });

  useCommand({
    id: "file.export",
    title: "Export…",
    shortcut: "⇧⌘E",
    // No keybinding: see project.open's comment above.
    run: () => {
      if (!project) return;
      setExportError(null);
      setExportOpen(true);
    },
  });

  useCommand({
    id: "editor.find",
    title: "Find",
    shortcut: "⌘F",
    // No keybinding: see project.open's comment above.
    run: () => findWidgetRef.current?.open(false),
  });
  useCommand({
    id: "editor.find-replace",
    title: "Find and Replace",
    shortcut: "⌥⌘F",
    // No keybinding: see project.open's comment above.
    run: () => findWidgetRef.current?.open(true),
  });

  useCommand({
    id: "layout.reset-split",
    title: "Reset Editor/Preview Split",
    run: () => setSplitFraction(0.5),
  });

  useCommand({
    id: "editor.toggle-focus-mode",
    title: "Toggle Focus Mode",
    run: () => setFocusMode((v) => !v),
  });
  useCommand({
    id: "editor.toggle-typewriter-scrolling",
    title: "Toggle Typewriter Scrolling",
    run: () => setTypewriterMode((v) => !v),
  });
  useCommand({
    id: "editor.toggle-prose-mode",
    title: "Toggle Serif Prose Mode",
    run: () => setProseMode((v) => !v),
  });
  useCommand({
    id: "editor.toggle-word-wrap",
    title: "Toggle Word Wrap",
    run: () => setWordWrap((v) => !v),
  });

  const { register: registerCommand } = useCommandRegistrar();
  useEffect(() => {
    const unregisters = allThemes(customThemes).map((theme) =>
      registerCommand({
        id: `theme.select.${theme.id}`,
        title: `Theme: ${theme.name}`,
        run: () => setThemeId(theme.id),
      }),
    );
    return () => unregisters.forEach((unregister) => unregister());
  }, [customThemes, registerCommand]);

  useCommand({
    id: "pdf.toggle-inversion",
    title: "Toggle PDF Inversion",
    run: () => setPdfInverted((v) => !v),
  });

  useCommand({
    id: "app.open-settings",
    title: "Settings…",
    shortcut: "⌘,",
    // No keybinding: see project.open's comment above.
    run: () => setSettingsOpen(true),
  });

  const toggleSidebarSection = useCallback((kind: PanelKind) => {
    setSidebarSection((current) => (current === kind ? null : kind));
  }, []);

  // No keybinding on these three: see project.open's comment for why.
  useCommand({
    id: "panel.file-tree",
    title: "Show Explorer",
    shortcut: "⌘1",
    run: () => toggleSidebarSection("file-tree"),
  });
  useCommand({
    id: "panel.search",
    title: "Show Search",
    shortcut: "⌘⇧F",
    run: () => toggleSidebarSection("search"),
  });
  useCommand({
    id: "panel.outline",
    title: "Show Outline",
    shortcut: "⌘2",
    run: () => toggleSidebarSection("outline"),
  });
  useCommand({
    id: "panel.problems",
    title: "Show Problems",
    shortcut: "⌘3",
    run: () => toggleSidebarSection("problems"),
  });
  useCommand({
    id: "panel.packages",
    title: "Show Packages",
    run: () => toggleSidebarSection("packages"),
  });
  useCommand({
    id: "panel.snippets",
    title: "Show Snippets",
    run: () => toggleSidebarSection("snippets"),
  });

  function renderPanelBody(kind: PanelKind) {
    switch (kind) {
      case "file-tree":
        return (
          <FileTreePanel
            ref={fileTreeRef}
            tree={explorerTree}
            rootUri={project?.projectId ?? ""}
            activeUri={activeUri}
            targetRoot={targetRoot}
            onSelectFile={openTab}
            onCreateFile={createExplorerFile}
            onCreateDirectory={createExplorerDirectory}
            onRename={renameExplorerEntry}
            onMove={moveExplorerEntry}
            onCopy={copyExplorerEntry}
            onTrash={trashExplorerEntry}
            onReveal={revealExplorerEntry}
            onRetarget={retargetRoot}
          />
        );
      case "search":
        return (
          <SearchPanel
            projectId={project?.projectId ?? ""}
            dirtyBuffers={tabsRef.current.map((t) => ({ uri: t.uri, text: t.text }))}
            onSelectMatch={revealSearchMatch}
            onReplaceAll={applyReplaceResults}
          />
        );
      case "outline":
        return (
          <OutlinePanel
            projectId={project?.projectId ?? ""}
            uri={activeUri ?? ""}
            refreshToken={compileVersion}
            onSelectNode={revealOutlineNode}
          />
        );
      case "problems":
        return <ProblemsPanel diagnostics={diagnostics} onSelect={revealDiagnostic} />;
      case "packages":
        return <PackagesPanel onChanged={() => setPackagesRefreshToken((t) => t + 1)} />;
      case "snippets":
        return <SnippetsPanel onInsert={(id) => editorRef.current?.insertSnippet(id)} />;
    }
  }

  const activeTab = tabs.find((t) => t.uri === activeUri) ?? null;
  const editorDiagnostics = activeTab ? diagnostics.filter((d) => d.uri === activeTab.uri) : [];

  return (
    <div className="app">
      <div className="app__titlebar" />
      <CommandPalette />
      {settingsOpen && (
        <SettingsDialog
          systemTexStatus={systemTexStatus}
          useSystemTex={useSystemTex}
          onToggleSystemTex={setUseSystemTex}
          focusMode={focusMode}
          onToggleFocusMode={setFocusMode}
          typewriterMode={typewriterMode}
          onToggleTypewriterMode={setTypewriterMode}
          proseMode={proseMode}
          onToggleProseMode={setProseMode}
          wordWrap={wordWrap}
          onToggleWordWrap={setWordWrap}
          themeId={themeId}
          onSelectTheme={setThemeId}
          customThemes={customThemes}
          onRequestNewTheme={openNewThemeEditor}
          onRequestEditTheme={openThemeEditorFor}
          onDeleteTheme={deleteCustomTheme}
          themeEditorOpen={themeEditor !== null}
          pdfInverted={pdfInverted}
          onTogglePdfInverted={setPdfInverted}
          onClose={() => setSettingsOpen(false)}
        />
      )}
      {themeEditor && (
        <ThemeEditorDialog
          base={themeEditor.base}
          editingId={themeEditor.editingId}
          onSave={saveCustomTheme}
          onCancel={cancelThemeEditor}
          onPreview={applyTheme}
        />
      )}
      {newProjectOpen && (
        <NewProjectDialog onSelect={createProjectFromSelection} onClose={() => setNewProjectOpen(false)} />
      )}
      {exportOpen && (
        <ExportDialog
          onExport={handleExport}
          onClose={() => setExportOpen(false)}
          busy={exportBusy}
          error={exportError}
          rootUri={currentRoot}
          texFiles={collectTexFiles(explorerTree).map((f) => ({
            uri: f.uri,
            label: toProjectRelativePath(f.uri, project?.projectId ?? ""),
          }))}
          onSelectRoot={retargetRoot}
        />
      )}
      <div className="app__body">
        <ActivityBar active={sidebarSection} onSelect={toggleSidebarSection} problemCount={diagnostics.length} />
        {sidebarSection && (
          <Sidebar
            title={PANEL_TITLES[sidebarSection]}
            caption={sidebarSection === "packages" ? `${formatBytes(packagesCacheBytes)} cached` : undefined}
            action={
              sidebarSection === "file-tree" &&
              project && (
                <div className="panel-shell__actions">
                  <button
                    type="button"
                    className="panel-shell__action"
                    onClick={() => fileTreeRef.current?.startCreatingAtRoot("file")}
                    aria-label="New File"
                    title="New File"
                  >
                    <Plus size={14} strokeWidth={1.8} aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    className="panel-shell__action"
                    onClick={() => fileTreeRef.current?.startCreatingAtRoot("directory")}
                    aria-label="New Folder"
                    title="New Folder"
                  >
                    <FolderPlus size={14} strokeWidth={1.8} aria-hidden="true" />
                  </button>
                </div>
              )
            }
            width={sidebarWidth}
            onWidthChange={setSidebarWidth}
          >
            {renderPanelBody(sidebarSection)}
          </Sidebar>
        )}
        <div className="app__main">
          <TabBar
            tabs={tabs.map((t) => ({ uri: t.uri, label: basename(t.uri), dirty: t.text !== t.savedText }))}
            activeUri={activeUri}
            onActivate={setActiveUri}
            onClose={closeTab}
            onSaveAndClose={saveAndCloseTab}
          />
          {!project ? (
            <WelcomeScreen onOpenFolder={openFolderPicker} onNewProject={() => setNewProjectOpen(true)} />
          ) : (
            <div
              className="app__panes"
              ref={containerRef}
              style={{ gridTemplateColumns: `${splitFraction}fr var(--s-2) ${1 - splitFraction}fr` }}
            >
              <div className="app__pane app__pane--editor">
                {activeTab ? (
                  <Editor
                    ref={editorRef}
                    key={activeTab.uri}
                    initialDoc={activeTab.text}
                    projectId={project.projectId}
                    uri={activeTab.uri}
                    appearance={resolvedTheme.appearance}
                    focusMode={focusMode}
                    typewriterMode={typewriterMode}
                    proseMode={proseMode}
                    wordWrap={wordWrap}
                    restoreCursor={activeTab.cursor}
                    restoreScrollTop={activeTab.scrollTop}
                    onChange={scheduleCompile}
                    onCursorActivity={handleCursorActivity}
                    diagnostics={editorDiagnostics}
                    onFindShortcut={(withReplace) => findWidgetRef.current?.open(withReplace)}
                  />
                ) : (
                  <p className="app__pane-empty">No file open. Select one from Explorer, or ⌘N for a new file.</p>
                )}
                <FindWidget ref={findWidgetRef} editorRef={editorRef} activeUri={activeTab?.uri ?? null} />
              </div>
              <Seam
                state={seamState}
                containerRef={containerRef}
                onChange={setSplitFraction}
                onReset={() => setSplitFraction(0.5)}
              />
              <div className="app__pane app__pane--preview">
                {error ? (
                  <pre className="app__error">{error}</pre>
                ) : (
                  <>
                    <PdfViewer data={pdfData} changedPages={changedPages} inverted={pdfInverted} />
                    {missingPackages && missingPackages.length > 0 && (
                      <MissingPackagesCard
                        packages={missingPackages}
                        installState={packageInstallState}
                        failedNames={failedPackageNames}
                        onInstall={installMissingPackages}
                      />
                    )}
                  </>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
      <StatusBar
        problemCount={diagnostics.length}
        cursorPosition={cursorStore}
        engineAvailable={project?.engineAvailable ?? null}
        bundleVersionNotice={bundleVersionNotice}
        onDismissBundleVersionNotice={() => setBundleVersionNotice(null)}
      />
    </div>
  );
}
