import { useCallback, useEffect, useRef, useState } from "react";
import type { CompileReason, CoreEvent, Diagnostic, FileNode } from "@quire/client";
import { CommandPalette } from "./commands/CommandPalette";
import { CommandProvider, useCommand } from "./commands/CommandContext";
import { Editor, INITIAL_SOURCE } from "./Editor";
import { buildFileTree } from "./panels/fileTree";
import { FileTreePanel } from "./panels/FileTreePanel";
import { OutlinePanel } from "./panels/OutlinePanel";
import { ProblemsPanel } from "./panels/ProblemsPanel";
import { SummonedPanel } from "./panels/SummonedPanel";
import type { PanelKind } from "./panels/types";
import { PdfViewer } from "./PdfViewer";
import { Seam } from "./Seam";
import type { SeamState } from "./Seam";
import { TopBar } from "./TopBar";
import "./App.css";

const DEBOUNCE_MS = 500;

interface Project {
  projectId: string;
  uri: string;
  label: string;
  /** `null` for the scratch/placeholder project, which never calls the
   * real `openProject` and so has no real answer for this. */
  engineAvailable: boolean | null;
  /** `[]` for the scratch project (which never calls `openProject`, so
   * there's genuinely no file list for it) -- real once a project has
   * actually been opened. */
  files: FileNode[];
}

function basename(p: string): string {
  const parts = p.split(/[/\\]/).filter(Boolean);
  return parts[parts.length - 1] ?? p;
}

const PANEL_TITLES: Record<PanelKind, string> = {
  "file-tree": "File Tree",
  outline: "Outline",
  problems: "Problems",
};

// File tree pinned by default (direct request, ahead of/overriding
// 2.5's original "default state shows none of them" -- this supersedes
// that for file-tree specifically). Not persisted across launches yet;
// that's session-restore's job (task 2.10), not this one's.
const DEFAULT_PINNED: Record<PanelKind, boolean> = {
  "file-tree": true,
  outline: false,
  problems: false,
};

export function App() {
  return (
    <CommandProvider>
      <AppShell />
    </CommandProvider>
  );
}

// Split out from App() so useCommand() below has a CommandProvider
// ancestor to register into -- a component can't consume a context it
// provides in that same render.
function AppShell() {
  const [project, setProject] = useState<Project | null>(null);
  const [initialDoc, setInitialDoc] = useState(INITIAL_SOURCE);
  const [pdfData, setPdfData] = useState<Uint8Array | null>(null);
  const [changedPages, setChangedPages] = useState<number[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [seamState, setSeamState] = useState<SeamState>("idle");
  const [splitFraction, setSplitFraction] = useState(0.5);
  const [diagnostics, setDiagnostics] = useState<Diagnostic[]>([]);
  const [compileVersion, setCompileVersion] = useState(0);
  // Pinned: docked permanently in the sidebar. Not pinned: at most one at
  // a time shows as the ephemeral overlay (`overlayPanel`), exactly as
  // before pinning existed.
  const [pinned, setPinned] = useState<Record<PanelKind, boolean>>(DEFAULT_PINNED);
  const [overlayPanel, setOverlayPanel] = useState<PanelKind | null>(null);

  const projectRef = useRef<Project | null>(null);
  const currentSourceRef = useRef(INITIAL_SOURCE);
  const debounceRef = useRef<number | undefined>(undefined);
  const errorTimeoutRef = useRef<number | undefined>(undefined);
  const containerRef = useRef<HTMLDivElement>(null);

  // A new compile request kills whatever the sidecar is still running
  // (single-flight, task 1.4), so a superseded call's promise never
  // settles -- no risk of a stale result overwriting a newer one here.
  const runCompile = useCallback(
    async (projectId: string, uri: string, source: string, reason: CompileReason) => {
      try {
        const result = await window.quire.compile({
          projectId,
          dirtyBuffers: [{ uri, text: source }],
          reason,
        });
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
        setError(String((err as Error)?.message ?? err));
      }
    },
    [],
  );

  const scheduleCompile = useCallback(
    (source: string) => {
      currentSourceRef.current = source;
      if (debounceRef.current !== undefined) window.clearTimeout(debounceRef.current);
      debounceRef.current = window.setTimeout(() => {
        const current = projectRef.current;
        if (current) runCompile(current.projectId, current.uri, source, "edit");
      }, DEBOUNCE_MS);
    },
    [runCompile],
  );

  const openProjectFlow = useCallback(async () => {
    const path = await window.quireDesktop.chooseProjectFolder();
    if (!path) return;

    try {
      const opened = await window.quire.openProject({ path });
      const initialText = await window.quire.readFile(opened.root);
      const next: Project = {
        projectId: opened.projectId,
        uri: opened.root,
        label: basename(opened.projectId),
        engineAvailable: opened.engineAvailable,
        files: opened.files,
      };
      projectRef.current = next;
      setProject(next);
      currentSourceRef.current = initialText;
      setInitialDoc(initialText);
      runCompile(next.projectId, next.uri, initialText, "open");
    } catch (err) {
      setError(String((err as Error)?.message ?? err));
    }
  }, [runCompile]);

  // File tree ⌘1: switches which file of the *current* project is open
  // in the editor. Only ever called with a `.tex` leaf's real uri (see
  // FileTreePanel) -- graphics have nothing to switch into.
  const switchToFile = useCallback(
    async (uri: string) => {
      const current = projectRef.current;
      if (!current || uri === current.uri) return;

      try {
        const text = await window.quire.readFile(uri);
        const next: Project = { ...current, uri };
        projectRef.current = next;
        setProject(next);
        currentSourceRef.current = text;
        setInitialDoc(text);
        runCompile(next.projectId, uri, text, "open");
      } catch (err) {
        setError(String((err as Error)?.message ?? err));
      }
    },
    [runCompile],
  );

  // Scratch project: a disposable one-file project backing the
  // placeholder doc shown before the user opens anything (task 1.8's
  // scratch mechanism). Runs once; openProjectFlow() replaces it later.
  useEffect(() => {
    (async () => {
      const scratch = await window.quireDesktop.createScratchProject();
      const next: Project = {
        projectId: scratch.projectId,
        uri: scratch.root,
        label: "Untitled",
        engineAvailable: null,
        files: [],
      };
      projectRef.current = next;
      setProject(next);
      runCompile(next.projectId, next.uri, INITIAL_SOURCE, "open");
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The seam's compile state, and reacting to an externally-triggered
  // recompile (another editor, `git pull`, ... -- task 1.3, now driven by
  // `files-changed`), both come from the same real CoreEvent stream
  // (task 2.3) instead of a bespoke IPC event apps/desktop used to invent
  // for this.
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
        const current = projectRef.current;
        if (current && event.projectId === current.projectId) {
          runCompile(current.projectId, current.uri, currentSourceRef.current, "edit");
        }
      }
    });
  }, [runCompile]);

  // No "Open Project" button in the top bar (Section 7's layout has
  // none) -- every action in the app has to be reachable some other way
  // instead, which for this one is both a real keybinding and a palette
  // entry, registered once here.
  useCommand({
    id: "project.open",
    title: "Open Project…",
    shortcut: "⌘O",
    keybinding: { key: "o", meta: true },
    run: openProjectFlow,
  });

  useCommand({
    id: "layout.reset-split",
    title: "Reset Editor/Preview Split",
    run: () => setSplitFraction(0.5),
  });

  // ⌘1/⌘2/⌘3 toggle the ephemeral overlay; a pinned panel is already
  // permanently visible, so there's nothing left for the shortcut to do.
  const togglePanel = useCallback(
    (kind: PanelKind) => {
      if (pinned[kind]) return;
      setOverlayPanel((current) => (current === kind ? null : kind));
    },
    [pinned],
  );

  // Pinning promotes the current overlay into the sidebar; unpinning
  // demotes it back to fully closed, not back to "open as overlay" --
  // that would just be a confusing third state to land in.
  const pinPanel = useCallback((kind: PanelKind) => {
    setPinned((p) => ({ ...p, [kind]: true }));
    setOverlayPanel((current) => (current === kind ? null : current));
  }, []);

  const unpinPanel = useCallback((kind: PanelKind) => {
    setPinned((p) => ({ ...p, [kind]: false }));
  }, []);

  useCommand({
    id: "panel.file-tree",
    title: "Show File Tree",
    shortcut: "⌘1",
    keybinding: { key: "1", meta: true },
    run: () => togglePanel("file-tree"),
  });
  useCommand({
    id: "panel.outline",
    title: "Show Outline",
    shortcut: "⌘2",
    keybinding: { key: "2", meta: true },
    run: () => togglePanel("outline"),
  });
  useCommand({
    id: "panel.problems",
    title: "Show Problems",
    shortcut: "⌘3",
    keybinding: { key: "3", meta: true },
    run: () => togglePanel("problems"),
  });

  // Section 7: summoned panels "dismiss on Escape" -- separate from the
  // command registry's own keydown dispatch (Escape isn't a discoverable
  // named command, it's a universal modal-dismiss key, same as the
  // command palette's own Escape handling). Only ever touches the
  // ephemeral overlay -- Escape doesn't rip a deliberately pinned panel
  // out of the layout.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && overlayPanel !== null) {
        setOverlayPanel(null);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [overlayPanel]);

  function renderPanelBody(kind: PanelKind) {
    switch (kind) {
      case "file-tree":
        return (
          <FileTreePanel
            tree={buildFileTree(project?.files ?? [], project?.projectId ?? "")}
            activeUri={project?.uri ?? null}
            onSelectFile={(uri) => {
              switchToFile(uri);
              setOverlayPanel(null);
            }}
          />
        );
      case "outline":
        return <OutlinePanel projectId={project?.projectId ?? ""} uri={project?.uri ?? ""} refreshToken={compileVersion} />;
      case "problems":
        return <ProblemsPanel diagnostics={diagnostics} />;
    }
  }

  const pinnedKinds = (Object.keys(pinned) as PanelKind[]).filter((kind) => pinned[kind]);

  return (
    <div className="app">
      <CommandPalette />
      <TopBar projectLabel={project?.label ?? "Untitled"} engineAvailable={project?.engineAvailable ?? null} />
      <div className="app__body">
        {pinnedKinds.length > 0 && (
          <aside className="app__sidebar">
            {pinnedKinds.map((kind) => (
              <SummonedPanel
                key={kind}
                pinned
                title={PANEL_TITLES[kind]}
                caption={kind === "file-tree" ? "Files reachable from the root document." : undefined}
                onTogglePin={() => unpinPanel(kind)}
              >
                {renderPanelBody(kind)}
              </SummonedPanel>
            ))}
          </aside>
        )}
        <div
          className="app__panes"
          ref={containerRef}
          style={{ gridTemplateColumns: `${splitFraction}fr var(--s-2) ${1 - splitFraction}fr` }}
        >
          <div className="app__pane app__pane--editor">
            {project && (
              <Editor
                key={project.uri}
                initialDoc={initialDoc}
                projectId={project.projectId}
                uri={project.uri}
                onChange={scheduleCompile}
              />
            )}
            {overlayPanel && !pinned[overlayPanel] && (
              <SummonedPanel
                title={PANEL_TITLES[overlayPanel]}
                caption={overlayPanel === "file-tree" ? "Files reachable from the root document." : undefined}
                onTogglePin={() => pinPanel(overlayPanel)}
              >
                {renderPanelBody(overlayPanel)}
              </SummonedPanel>
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
              <PdfViewer data={pdfData} changedPages={changedPages} />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
