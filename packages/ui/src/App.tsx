import { useCallback, useEffect, useRef, useState } from "react";
import type { CompileReason, CoreEvent, DetectSystemTexResponse, Diagnostic, FileNode } from "@quire/client";
import { ActivityBar } from "./ActivityBar";
import { CommandPalette } from "./commands/CommandPalette";
import { CommandProvider, useCommand } from "./commands/CommandContext";
import { Editor, INITIAL_SOURCE } from "./Editor";
import type { EditorHandle } from "./Editor";
import { formatLatex } from "./latex/formatter";
import { useMenuBridge } from "./menuBridge";
import { buildFileTree } from "./panels/fileTree";
import { FileTreePanel } from "./panels/FileTreePanel";
import { OutlinePanel } from "./panels/OutlinePanel";
import { formatBytes, PackagesPanel } from "./panels/PackagesPanel";
import { ProblemsPanel } from "./panels/ProblemsPanel";
import type { PanelKind } from "./panels/types";
import { MissingPackagesCard } from "./MissingPackagesCard";
import type { PackageInstallState } from "./MissingPackagesCard";
import { PdfViewer } from "./PdfViewer";
import { Seam } from "./Seam";
import type { SeamState } from "./Seam";
import { SettingsDialog } from "./SettingsDialog";
import { Sidebar } from "./Sidebar";
import { normalizeSession, type SessionState } from "./session";
import type { CursorPosition, CursorPositionStore } from "./StatusBar";
import { StatusBar } from "./StatusBar";
import { TabBar } from "./TabBar";
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

interface Project {
  projectId: string;
  label: string;
  /** `null` for the scratch project, which never calls real `openProject`. */
  engineAvailable: boolean | null;
  /** `[]` for the scratch project, same reason. */
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

function basename(p: string): string {
  const parts = p.split(/[/\\]/).filter(Boolean);
  return parts[parts.length - 1] ?? p;
}

const PANEL_TITLES: Record<PanelKind, string> = {
  "file-tree": "Explorer",
  outline: "Outline",
  problems: "Problems",
  packages: "Packages",
};

const DEFAULT_SESSION: SessionState = {
  projectPath: null,
  openTabs: [],
  activeUri: null,
  sidebarSection: "file-tree",
  sidebarWidth: 240,
  splitFraction: 0.5,
  focusMode: false,
  typewriterMode: false,
  proseMode: false,
  wordWrap: false,
  theme: "dark",
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
  const [theme, setTheme] = useState<"dark" | "light">(() =>
    localStorage.getItem("quire-theme") === "light" ? "light" : "dark",
  );
  const [pdfInverted, setPdfInverted] = useState(false);
  const [useSystemTex, setUseSystemTex] = useState(false);
  const [systemTexStatus, setSystemTexStatus] = useState<DetectSystemTexResponse | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [cursorStore] = useState(() => createCursorPositionStore());

  const projectRef = useRef<Project | null>(null);
  // tabsRef is authoritative and updated outside React state; `tabs` state only exists to repaint the tab bar.
  const tabsRef = useRef<OpenTab[]>([]);
  const editorRef = useRef<EditorHandle>(null);
  const debounceRef = useRef<number | undefined>(undefined);
  const errorTimeoutRef = useRef<number | undefined>(undefined);
  const containerRef = useRef<HTMLDivElement>(null);
  const sessionRef = useRef<SessionState>(DEFAULT_SESSION);
  const saveSessionTimeoutRef = useRef<number | undefined>(undefined);
  // Guards against the save effect below firing before the restore-or-scratch effect finishes.
  const initializedRef = useRef(false);

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

  // Swallows SIDECAR_CALL_CANCELLED specifically -- a superseded compile's rejection, not a real error.
  const runCompile = useCallback(
    async (reason: CompileReason) => {
      const proj = projectRef.current;
      if (!proj) return;
      const dirtyBuffers = tabsRef.current.map((t) => ({ uri: t.uri, text: t.text }));
      try {
        const result = await window.quire.compile({
          projectId: proj.projectId,
          dirtyBuffers,
          reason,
          engine: useSystemTex ? "system" : "tectonic",
        });
        setDiagnostics(result.diagnostics);
        if (result.status === "ok" && result.pdfPath) {
          const bytes = await window.quireDesktop.readPdfFile(result.pdfPath);
          setPdfData(bytes);
          setChangedPages(result.changedPages);
          setError(null);
          setMissingPackages(null);
          setCompileVersion((v) => v + 1);
        } else if (result.status === "packages-missing") {
          // Not a raw error -- keep whatever PDF is already showing (9.6: "nothing has gone
          // wrong"), and let the card (not the error box) own this state.
          setError(null);
          setMissingPackages(result.missingPackages);
          setPackageInstallState("idle");
          setFailedPackageNames([]);
        } else {
          const diagnostic = result.diagnostics[0];
          setError(diagnostic?.rawMessage || diagnostic?.message || `Compile failed (${result.status}).`);
          setMissingPackages(null);
        }
      } catch (err) {
        const message = String((err as Error)?.message ?? err);
        if (message.includes(SIDECAR_CALL_CANCELLED)) return;
        setError(message);
      }
    },
    [useSystemTex],
  );

  // Best-effort: a prefetch failure (offline, RPC error) just means the first compile falls
  // back to fetching on demand, mid-flight, the same as before this existed -- never a reason
  // to block opening the project.
  const prefetchThenCompile = useCallback(
    async (projectId: string) => {
      try {
        await window.quire.prefetchPackages(projectId);
      } catch {
        // See above.
      }
      runCompile("open");
    },
    [runCompile],
  );

  // Reuses 4.3's prefetchPackages wholesale rather than a separate "install these specific
  // packages" RPC -- it re-scans the same project for the same \usepackage/\documentclass/
  // \RequirePackage commands, so it naturally targets the same missing set.
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

  // Real reconnect signal (Chromium's own network-state detection), not a poll -- 9.6's "queued
  // retry on reconnect".
  useEffect(() => {
    if (packageInstallState !== "offline") return;
    const retry = () => installMissingPackages();
    window.addEventListener("online", retry);
    return () => window.removeEventListener("online", retry);
  }, [packageInstallState, installMissingPackages]);

  // Sidebar caption's cache-size number -- only fetched while the packages section is actually
  // visible, and refetched whenever PackagesPanel reports an install/remove (packagesRefreshToken).
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

  // Task 4.9: checked once at startup, not reactively -- a system TeX install doesn't come or go
  // while the app is running. Self-heals a persisted `useSystemTex: true` from a prior session if
  // the install is no longer there, rather than letting the next compile surface an avoidable
  // "engine missing" error for a state the Settings dialog would already show as unavailable.
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

  const closeTab = useCallback((uri: string) => {
    const current = tabsRef.current;
    if (current.length <= 1) return;
    const idx = current.findIndex((t) => t.uri === uri);
    if (idx === -1) return;
    const next = current.filter((t) => t.uri !== uri);
    tabsRef.current = next;
    setTabs(next);
    setActiveUri((activePrev) => {
      if (activePrev !== uri) return activePrev;
      const neighbor = current[idx + 1] ?? current[idx - 1];
      return neighbor.uri;
    });
  }, []);

  const saveTab = useCallback(
    async (uri: string) => {
      const idx = tabsRef.current.findIndex((t) => t.uri === uri);
      if (idx === -1) return;
      const tab = tabsRef.current[idx];
      const formatted = formatLatex(tab.text);
      if (formatted !== tab.text) {
        if (uri === activeUri) {
          // -> onChange -> scheduleCompile updates tabsRef[idx].text synchronously (CM6 dispatch
          // and its updateListener run synchronously) and arms a debounced "edit" recompile,
          // cancelled below so it can't race the "save" compile.
          editorRef.current?.replaceContent(formatted);
        } else {
          // Not the mounted tab -- no live view to push into; initialDoc only re-seeds on remount.
          const next = tabsRef.current.slice();
          next[idx] = { ...tab, text: formatted };
          tabsRef.current = next;
        }
      }
      const current = tabsRef.current[idx];
      try {
        await window.quire.writeFile(uri, current.text);
        const next = tabsRef.current.slice();
        next[idx] = { ...tabsRef.current[idx], savedText: current.text };
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

  // Shared by the initial-launch fallback below and the "Close Folder" command -- both need the
  // exact same fresh, empty scratch project, not two copies of this logic.
  const createFreshScratchProject = useCallback(async (): Promise<{ project: Project; tab: OpenTab }> => {
    const scratch = await window.quireDesktop.createScratchProject();
    const project: Project = {
      projectId: scratch.projectId,
      label: "Untitled",
      engineAvailable: null,
      files: [],
    };
    const tab: OpenTab = { uri: scratch.root, text: INITIAL_SOURCE, savedText: INITIAL_SOURCE, cursor: 0, scrollTop: null };
    // The scratch project never calls real openProject, so any notice from a previously open real project no longer applies.
    setBundleVersionNotice(null);
    return { project, tab };
  }, []);

  const applyProject = useCallback((project: Project, tabs: OpenTab[], activeUri: string) => {
    projectRef.current = project;
    setProject(project);
    tabsRef.current = tabs;
    setTabs(tabs);
    setActiveUri(activeUri);
  }, []);

  useEffect(() => {
    (async () => {
      const loaded = await window.quireDesktop.loadSession();
      const session = loaded ? normalizeSession(loaded, DEFAULT_SESSION) : null;

      if (session) {
        setSplitFraction(session.splitFraction);
        setFocusMode(session.focusMode);
        setTypewriterMode(session.typewriterMode);
        setProseMode(session.proseMode);
        setWordWrap(session.wordWrap);
        setTheme(session.theme);
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

          // A missing file is skipped, not fatal -- restore whatever's still there instead of falling back to scratch.
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
          // If even the root is unreadable this throws into the outer catch, degrading to the scratch project below.
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
          prefetchThenCompile(next.projectId);
          initializedRef.current = true;
          return;
        } catch {
          // Path moved/deleted/otherwise unreadable -- fall through to the scratch project below, same as a fresh launch.
        }
      }

      const { project: freshProject, tab } = await createFreshScratchProject();
      applyProject(freshProject, [tab], tab.uri);
      runCompile("open");
      initializedRef.current = true;
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("quire-theme", theme);
  }, [theme]);

  useEffect(() => {
    if (!initializedRef.current) return;
    const isRealProject = project && project.engineAvailable !== null;
    sessionRef.current = {
      ...sessionRef.current,
      projectPath: isRealProject ? project.projectId : null,
      openTabs: isRealProject ? tabs.map((t) => t.uri) : [],
      activeUri: isRealProject ? activeUri : null,
      sidebarSection,
      sidebarWidth,
      splitFraction,
      focusMode,
      typewriterMode,
      proseMode,
      wordWrap,
      theme,
      pdfInverted,
      useSystemTex,
    };
    scheduleSaveSession();
  }, [
    project,
    tabs,
    activeUri,
    sidebarSection,
    sidebarWidth,
    splitFraction,
    focusMode,
    typewriterMode,
    proseMode,
    wordWrap,
    theme,
    pdfInverted,
    useSystemTex,
    scheduleSaveSession,
  ]);

  // Electron menu items don't reactively bind to renderer state -- this keeps the native View
  // menu's checkboxes (apps/desktop/src/main.js) in sync whenever any of them changes, regardless
  // of whether the change came from the menu itself, the command palette, or a keybinding.
  useEffect(() => {
    if (!initializedRef.current) return;
    window.quireDesktop.reportViewState({
      "file-tree": sidebarSection === "file-tree",
      outline: sidebarSection === "outline",
      problems: sidebarSection === "problems",
      packages: sidebarSection === "packages",
      focusMode,
      typewriterMode,
      proseMode,
      wordWrap,
      lightTheme: theme === "light",
      pdfInverted,
    });
  }, [sidebarSection, focusMode, typewriterMode, proseMode, wordWrap, theme, pdfInverted]);

  useEffect(() => {
    return window.quire.onEvent((event: CoreEvent) => {
      if (event.kind === "compile-started") {
        if (errorTimeoutRef.current !== undefined) window.clearTimeout(errorTimeoutRef.current);
        setSeamState("compiling");
      } else if (event.kind === "compile-finished") {
        // packages-missing reads as "idle," not "error" -- 9.6: nothing has gone wrong, the card
        // owns that messaging, not a red seam flash.
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
        }
      }
    });
  }, [runCompile]);

  useCommand({
    id: "project.open",
    title: "Open Folder…",
    shortcut: "⌘O",
    // No keybinding: the File menu's native "Open Folder…" accelerator (⌘O) dispatches through
    // menuBridge instead -- registering both here would double-fire on the same keypress.
    run: async () => {
      const path = await window.quireDesktop.chooseProjectFolder();
      if (!path) return;
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
        prefetchThenCompile(next.projectId);
      } catch (err) {
        setError(String((err as Error)?.message ?? err));
      }
    },
  });

  useCommand({
    id: "file.new",
    title: "New File",
    shortcut: "⌘N",
    run: async () => {
      if (!project) return;
      const path = await window.quireDesktop.createFile(project.projectId);
      if (!path) return;
      await openTab(path);
    },
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
    id: "file.close-folder",
    title: "Close Folder",
    run: async () => {
      const dirty = tabsRef.current.filter((t) => t.text !== t.savedText);
      if (dirty.length > 0) {
        const choice = await window.quireDesktop.confirmDiscard(
          dirty.length === 1 ? `Save changes to ${basename(dirty[0].uri)}?` : `Save changes to ${dirty.length} files?`,
        );
        if (choice === "cancel") return;
        if (choice === "save") {
          for (const t of dirty) await saveTab(t.uri);
        }
      }
      const { project: freshProject, tab } = await createFreshScratchProject();
      applyProject(freshProject, [tab], tab.uri);
      runCompile("open");
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
      // No live-view push needed here (unlike saveTab) -- the tab's `uri` changes below, which
      // changes <Editor>'s `key` in the JSX and forces a remount, so the new `initialDoc` picks
      // up this already-formatted text naturally.
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

  useCommand({
    id: "app.toggle-theme",
    title: "Toggle Theme",
    run: () => setTheme((t) => (t === "dark" ? "light" : "dark")),
  });
  useCommand({
    id: "pdf.toggle-inversion",
    title: "Toggle PDF Inversion",
    run: () => setPdfInverted((v) => !v),
  });

  useCommand({
    id: "app.open-settings",
    title: "Settings…",
    shortcut: "⌘,",
    // No keybinding: the File menu's native "Settings…" accelerator (⌘,) dispatches through
    // menuBridge instead -- registering both here would double-fire on the same keypress.
    run: () => setSettingsOpen(true),
  });

  const toggleSidebarSection = useCallback((kind: PanelKind) => {
    setSidebarSection((current) => (current === kind ? null : kind));
  }, []);

  // No keybinding on these three: the View menu's native ⌘1/⌘2/⌘3 accelerators dispatch through
  // menuBridge instead (see project.open's comment for why -- registering both risks a double-fire).
  useCommand({
    id: "panel.file-tree",
    title: "Show Explorer",
    shortcut: "⌘1",
    run: () => toggleSidebarSection("file-tree"),
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

  function renderPanelBody(kind: PanelKind) {
    switch (kind) {
      case "file-tree":
        return (
          <FileTreePanel
            tree={buildFileTree(project?.files ?? [], project?.projectId ?? "")}
            activeUri={activeUri}
            onSelectFile={openTab}
          />
        );
      case "outline":
        return <OutlinePanel projectId={project?.projectId ?? ""} uri={activeUri ?? ""} refreshToken={compileVersion} />;
      case "problems":
        return <ProblemsPanel diagnostics={diagnostics} />;
      case "packages":
        return <PackagesPanel onChanged={() => setPackagesRefreshToken((t) => t + 1)} />;
    }
  }

  const activeTab = tabs.find((t) => t.uri === activeUri) ?? null;
  const editorDiagnostics = activeTab ? diagnostics.filter((d) => d.uri === activeTab.uri) : [];

  return (
    <div className="app">
      <CommandPalette />
      {settingsOpen && (
        <SettingsDialog
          systemTexStatus={systemTexStatus}
          useSystemTex={useSystemTex}
          onToggleSystemTex={setUseSystemTex}
          onClose={() => setSettingsOpen(false)}
        />
      )}
      <div className="app__body">
        <ActivityBar active={sidebarSection} onSelect={toggleSidebarSection} problemCount={diagnostics.length} />
        {sidebarSection && (
          <Sidebar
            title={PANEL_TITLES[sidebarSection]}
            caption={
              sidebarSection === "file-tree"
                ? "Files reachable from the root document."
                : sidebarSection === "packages"
                  ? `${formatBytes(packagesCacheBytes)} cached`
                  : undefined
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
          <div
            className="app__panes"
            ref={containerRef}
            style={{ gridTemplateColumns: `${splitFraction}fr var(--s-2) ${1 - splitFraction}fr` }}
          >
            <div className="app__pane app__pane--editor">
              {project && activeTab && (
                <Editor
                  ref={editorRef}
                  key={activeTab.uri}
                  initialDoc={activeTab.text}
                  projectId={project.projectId}
                  uri={activeTab.uri}
                  focusMode={focusMode}
                  typewriterMode={typewriterMode}
                  proseMode={proseMode}
                  wordWrap={wordWrap}
                  restoreCursor={activeTab.cursor}
                  restoreScrollTop={activeTab.scrollTop}
                  onChange={scheduleCompile}
                  onCursorActivity={handleCursorActivity}
                  diagnostics={editorDiagnostics}
                />
              )}
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
