import { useCallback, useEffect, useRef, useState } from "react";
import type { CompileReason, CoreEvent, Diagnostic, FileNode } from "@quire/client";
import { ActivityBar } from "./ActivityBar";
import { CommandPalette } from "./commands/CommandPalette";
import { CommandProvider, useCommand } from "./commands/CommandContext";
import { Editor, INITIAL_SOURCE } from "./Editor";
import { buildFileTree } from "./panels/fileTree";
import { FileTreePanel } from "./panels/FileTreePanel";
import { OutlinePanel } from "./panels/OutlinePanel";
import { ProblemsPanel } from "./panels/ProblemsPanel";
import type { PanelKind } from "./panels/types";
import { PdfViewer } from "./PdfViewer";
import { Seam } from "./Seam";
import type { SeamState } from "./Seam";
import { Sidebar } from "./Sidebar";
import { normalizeSession, type SessionState } from "./session";
import type { CursorPosition, CursorPositionStore } from "./StatusBar";
import { StatusBar } from "./StatusBar";
import { TabBar } from "./TabBar";
import { TopBar } from "./TopBar";
import "./App.css";

// A tiny external store, not ordinary lifted state -- cursor position changes on every keystroke
// (docChanged moves the cursor too), and StatusBar is the only thing that displays it. Routing it
// through AppShell's own state would re-render the whole tree (file tree, tab bar, everything) on
// every character typed; useSyncExternalStore lets only StatusBar itself re-render instead.
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

// Mirrors @quire/client's sidecarProcess.ts:SIDECAR_CALL_CANCELLED. Duplicated as a literal
// rather than imported -- this crosses both the Electron IPC boundary (ipcMain.handle serializes
// thrown errors down to a plain Error, so only .message survives) and, since @quire/client ships
// CommonJS for apps/desktop's plain `require()`, Vite's production build (which cannot resolve a
// named value export from that CJS package through the symlinked workspace dependency). Same
// tradeoff apps/desktop/src/{main,preload}.js already make for IPC channel names like
// "core:compile", duplicated as literals on both sides rather than shared across that boundary.
const SIDECAR_CALL_CANCELLED = "sidecar call cancelled";

interface Project {
  projectId: string;
  label: string;
  /** `null` for the scratch project, which never calls real `openProject`. */
  engineAvailable: boolean | null;
  /** `[]` for the scratch project, same reason. */
  files: FileNode[];
}

// One per open document (3.5.3). `text` is the live buffer -- always what's compiled and shown,
// regardless of whether it's been saved. `savedText` is what's actually on disk right now;
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
  openUri: null,
  splitFraction: 0.5,
  focusMode: false,
  typewriterMode: false,
  proseMode: false,
  theme: "dark",
  pdfInverted: false,
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
  const [project, setProject] = useState<Project | null>(null);
  const [tabs, setTabs] = useState<OpenTab[]>([]);
  const [activeUri, setActiveUri] = useState<string | null>(null);
  const [pdfData, setPdfData] = useState<Uint8Array | null>(null);
  const [changedPages, setChangedPages] = useState<number[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [seamState, setSeamState] = useState<SeamState>("idle");
  const [splitFraction, setSplitFraction] = useState(0.5);
  const [diagnostics, setDiagnostics] = useState<Diagnostic[]>([]);
  const [compileVersion, setCompileVersion] = useState(0);
  // Persistent (Section 7), not summoned -- null means collapsed. Open on Explorer by default.
  const [sidebarSection, setSidebarSection] = useState<PanelKind | null>("file-tree");
  const [sidebarWidth, setSidebarWidth] = useState(240);
  // Lifted above Editor (not local state there) so they survive the remount that happens when switching files/projects.
  const [focusMode, setFocusMode] = useState(false);
  const [typewriterMode, setTypewriterMode] = useState(false);
  const [proseMode, setProseMode] = useState(false);
  // Two independent settings (Section 7): switching one must never move the other.
  // Seeded from the same localStorage mirror index.html's inline script reads synchronously,
  // so this matches first paint instead of always starting "dark" and flashing on session load.
  const [theme, setTheme] = useState<"dark" | "light">(() =>
    localStorage.getItem("quire-theme") === "light" ? "light" : "dark",
  );
  const [pdfInverted, setPdfInverted] = useState(false);
  const [cursorStore] = useState(() => createCursorPositionStore());

  const projectRef = useRef<Project | null>(null);
  // Authoritative, updated synchronously outside React state so every keystroke doesn't force a
  // re-render (CM6 already manages its own text uncontrolled) -- `tabs` state exists only to
  // repaint the tab bar (dirty dot, add/remove/switch), and is refreshed from this ref only when
  // something actually needs to be seen.
  const tabsRef = useRef<OpenTab[]>([]);
  const debounceRef = useRef<number | undefined>(undefined);
  const errorTimeoutRef = useRef<number | undefined>(undefined);
  const containerRef = useRef<HTMLDivElement>(null);
  const sessionRef = useRef<SessionState>(DEFAULT_SESSION);
  const saveSessionTimeoutRef = useRef<number | undefined>(undefined);
  // Guards the "watch state, save" effect below from firing on the
  // initial render's default state, before the restore-or-scratch effect
  // has actually finished -- otherwise a slow restore could lose the
  // race and get overwritten on disk by a premature "nothing open yet"
  // snapshot.
  const initializedRef = useRef(false);

  const scheduleSaveSession = useCallback(() => {
    if (saveSessionTimeoutRef.current !== undefined) window.clearTimeout(saveSessionTimeoutRef.current);
    saveSessionTimeoutRef.current = window.setTimeout(() => {
      window.quireDesktop.saveSession(sessionRef.current);
    }, SAVE_SESSION_DEBOUNCE_MS);
  }, []);

  // Cursor/scroll come from Editor on every move -- updates the active tab's own record (so
  // switching away and back within this session restores position) plus the session snapshot
  // (still just "whichever tab was last active," same shape as before 3.5.3; a full per-tab
  // session shape is 3.5.6). Doesn't call setTabs -- nothing visibly depends on these fields
  // except the tab's own Editor mount, which only reads them once, at mount time.
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

  // Single-flight: a superseded compile is killed and its promise now rejects with
  // SIDECAR_CALL_CANCELLED (rather than hanging forever) -- swallow that one specifically so a
  // stale/cancelled compile neither overwrites a newer result nor flashes a spurious error.
  // Always compiles every open tab's live buffer, not just the active one -- a project with two
  // dirty tabs needs both reflected, and CompileRequest.dirtyBuffers already accepts an array.
  const runCompile = useCallback(async (reason: CompileReason) => {
    const proj = projectRef.current;
    if (!proj) return;
    const dirtyBuffers = tabsRef.current.map((t) => ({ uri: t.uri, text: t.text }));
    try {
      const result = await window.quire.compile({ projectId: proj.projectId, dirtyBuffers, reason });
      setDiagnostics(result.diagnostics);
      if (result.status === "ok" && result.pdfPath) {
        const bytes = await window.quireDesktop.readPdfFile(result.pdfPath);
        setPdfData(bytes);
        setChangedPages(result.changedPages);
        setError(null);
        setCompileVersion((v) => v + 1);
      } else {
        const diagnostic = result.diagnostics[0];
        setError(diagnostic?.rawMessage || diagnostic?.message || `Compile failed (${result.status}).`);
      }
    } catch (err) {
      const message = String((err as Error)?.message ?? err);
      if (message.includes(SIDECAR_CALL_CANCELLED)) return;
      setError(message);
    }
  }, []);

  // Updates the active tab's live buffer (ref-only -- see tabsRef's comment) and re-renders only
  // when dirty state actually flips, so typing doesn't repaint the tab bar on every keystroke.
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

  // Opening a file already open activates its tab instead of adding a duplicate (FileTreePanel
  // is the only caller today; graphics have nothing to open into, per its own selectability rule).
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

  // Never closes the last tab -- there's always something open, matching every other entry point
  // (openProjectFlow, session restore, the scratch fallback) always seeding at least one.
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
      // Prefer the tab that was to the right, else the one to the left -- standard tab-strip feel.
      const neighbor = current[idx + 1] ?? current[idx - 1];
      return neighbor.uri;
    });
  }, []);

  const saveTab = useCallback(
    async (uri: string) => {
      const idx = tabsRef.current.findIndex((t) => t.uri === uri);
      if (idx === -1) return;
      const tab = tabsRef.current[idx];
      try {
        await window.quire.writeFile(uri, tab.text);
        const next = tabsRef.current.slice();
        next[idx] = { ...tab, savedText: tab.text };
        tabsRef.current = next;
        setTabs(next);
        // Cancel a pending debounced edit-compile -- this save's own immediate compile already
        // covers it, and letting both fire is a harmless but pointless duplicate.
        if (debounceRef.current !== undefined) window.clearTimeout(debounceRef.current);
        runCompile("save");
      } catch (err) {
        setError(String((err as Error)?.message ?? err));
      }
    },
    [runCompile],
  );

  const saveAndCloseTab = useCallback(
    async (uri: string) => {
      await saveTab(uri);
      closeTab(uri);
    },
    [saveTab, closeTab],
  );

  // Restores the previous session if one exists and its project still opens;
  // otherwise (first launch, or the project has since moved/been deleted)
  // falls back to the same disposable scratch project as before session
  // restore existed. Layout/mode/theme settings restore either way -- a
  // project that's gone doesn't mean those should reset to defaults too.
  useEffect(() => {
    (async () => {
      const loaded = await window.quireDesktop.loadSession();
      const session = loaded ? normalizeSession(loaded, DEFAULT_SESSION) : null;

      if (session) {
        setSplitFraction(session.splitFraction);
        setFocusMode(session.focusMode);
        setTypewriterMode(session.typewriterMode);
        setProseMode(session.proseMode);
        setTheme(session.theme);
        setPdfInverted(session.pdfInverted);
      }

      if (session?.projectPath) {
        try {
          const opened = await window.quire.openProject({ path: session.projectPath });
          const uri = session.openUri ?? opened.root;
          const text = await window.quire.readFile(uri);
          const next: Project = {
            projectId: opened.projectId,
            label: basename(opened.projectId),
            engineAvailable: opened.engineAvailable,
            files: opened.files,
          };
          projectRef.current = next;
          setProject(next);
          const tab: OpenTab = {
            uri,
            text,
            savedText: text,
            cursor: session.cursor ?? 0,
            scrollTop: session.scrollTop,
          };
          tabsRef.current = [tab];
          setTabs(tabsRef.current);
          setActiveUri(uri);
          runCompile("open");
          initializedRef.current = true;
          return;
        } catch {
          // Path moved/deleted/otherwise unreadable -- fall through to the scratch project below, same as a fresh launch.
        }
      }

      const scratch = await window.quireDesktop.createScratchProject();
      const next: Project = {
        projectId: scratch.projectId,
        label: "Untitled",
        engineAvailable: null,
        files: [],
      };
      projectRef.current = next;
      setProject(next);
      const tab: OpenTab = { uri: scratch.root, text: INITIAL_SOURCE, savedText: INITIAL_SOURCE, cursor: 0, scrollTop: null };
      tabsRef.current = [tab];
      setTabs(tabsRef.current);
      setActiveUri(scratch.root);
      runCompile("open");
      initializedRef.current = true;
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // index.html's inline script reads this same key synchronously before first paint, so a saved
  // light theme doesn't flash dark while the real (async) session load is still in flight.
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("quire-theme", theme);
  }, [theme]);

  // Everything except cursor/scroll (handleCursorActivity above covers those) -- infrequent enough to just watch directly.
  useEffect(() => {
    if (!initializedRef.current) return;
    sessionRef.current = {
      ...sessionRef.current,
      projectPath: project && project.engineAvailable !== null ? project.projectId : null,
      openUri: project && project.engineAvailable !== null ? activeUri : null,
      splitFraction,
      focusMode,
      typewriterMode,
      proseMode,
      theme,
      pdfInverted,
    };
    scheduleSaveSession();
  }, [project, activeUri, splitFraction, focusMode, typewriterMode, proseMode, theme, pdfInverted, scheduleSaveSession]);

  // Seam compile state, and reacting to an externally-triggered recompile, both come from the same CoreEvent stream.
  useEffect(() => {
    return window.quire.onEvent((event: CoreEvent) => {
      if (event.kind === "compile-started") {
        if (errorTimeoutRef.current !== undefined) window.clearTimeout(errorTimeoutRef.current);
        setSeamState("compiling");
      } else if (event.kind === "compile-finished") {
        if (event.result.status === "ok") {
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

  // No "Open Project" button in the top bar -- reachable via keybinding/palette instead.
  useCommand({
    id: "project.open",
    title: "Open Project…",
    shortcut: "⌘O",
    keybinding: { key: "o", meta: true },
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
        projectRef.current = next;
        setProject(next);
        const tab: OpenTab = { uri: opened.root, text: initialText, savedText: initialText, cursor: 0, scrollTop: null };
        tabsRef.current = [tab];
        setTabs(tabsRef.current);
        setActiveUri(opened.root);
        runCompile("open");
      } catch (err) {
        setError(String((err as Error)?.message ?? err));
      }
    },
  });

  useCommand({
    id: "file.save",
    title: "Save",
    shortcut: "⌘S",
    keybinding: { key: "s", meta: true },
    run: () => {
      if (activeUri) saveTab(activeUri);
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

  // Deliberately two separate commands, not one -- see the `theme`/`pdfInverted` state comment.
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

  // Selecting the already-open section collapses the sidebar; selecting any other section
  // switches to it (opening the sidebar if it was collapsed). No separate "pinned" state --
  // the sidebar is either open on a section or fully collapsed.
  const toggleSidebarSection = useCallback((kind: PanelKind) => {
    setSidebarSection((current) => (current === kind ? null : kind));
  }, []);

  useCommand({
    id: "panel.file-tree",
    title: "Show Explorer",
    shortcut: "⌘1",
    keybinding: { key: "1", meta: true },
    run: () => toggleSidebarSection("file-tree"),
  });
  useCommand({
    id: "panel.outline",
    title: "Show Outline",
    shortcut: "⌘2",
    keybinding: { key: "2", meta: true },
    run: () => toggleSidebarSection("outline"),
  });
  useCommand({
    id: "panel.problems",
    title: "Show Problems",
    shortcut: "⌘3",
    keybinding: { key: "3", meta: true },
    run: () => toggleSidebarSection("problems"),
  });
  // No keybinding -- same as the other three had none reserved beyond ⌘1-3; still reachable
  // from the palette, matching "every action is reachable from the palette" (Section 8, 2.4).
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
        return (
          <p className="panel-empty">
            Package management isn't built yet. When it is, installed packages, search, and cache
            size will live here.
          </p>
        );
    }
  }

  const activeTab = tabs.find((t) => t.uri === activeUri) ?? null;

  return (
    <div className="app">
      <CommandPalette />
      <TopBar projectLabel={project?.label ?? "Untitled"} />
      <div className="app__body">
        <ActivityBar active={sidebarSection} onSelect={toggleSidebarSection} problemCount={diagnostics.length} />
        {sidebarSection && (
          <Sidebar
            title={PANEL_TITLES[sidebarSection]}
            caption={sidebarSection === "file-tree" ? "Files reachable from the root document." : undefined}
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
                  key={activeTab.uri}
                  initialDoc={activeTab.text}
                  projectId={project.projectId}
                  uri={activeTab.uri}
                  focusMode={focusMode}
                  typewriterMode={typewriterMode}
                  proseMode={proseMode}
                  restoreCursor={activeTab.cursor}
                  restoreScrollTop={activeTab.scrollTop}
                  onChange={scheduleCompile}
                  onCursorActivity={handleCursorActivity}
                />
              )}
            </div>
            <Seam
              state={seamState}
              containerRef={containerRef}
              onChange={setSplitFraction}
              onReset={() => setSplitFraction(0.5)}
            />
            <div className="app__pane">
              {error ? (
                <pre className="app__error">{error}</pre>
              ) : (
                <PdfViewer data={pdfData} changedPages={changedPages} inverted={pdfInverted} />
              )}
            </div>
          </div>
        </div>
      </div>
      <StatusBar
        problemCount={diagnostics.length}
        cursorPosition={cursorStore}
        engineAvailable={project?.engineAvailable ?? null}
      />
    </div>
  );
}
