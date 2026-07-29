import { useCallback, useEffect, useRef, useState } from "react";
import type { CompileReason, CoreEvent } from "@quire/client";
import { CommandPalette } from "./commands/CommandPalette";
import { CommandProvider, useCommand } from "./commands/CommandContext";
import { Editor, INITIAL_SOURCE } from "./Editor";
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
}

function basename(p: string): string {
  const parts = p.split(/[/\\]/).filter(Boolean);
  return parts[parts.length - 1] ?? p;
}

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
  const [error, setError] = useState<string | null>(null);
  const [seamState, setSeamState] = useState<SeamState>("idle");
  const [splitFraction, setSplitFraction] = useState(0.5);

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
        if (result.status === "ok" && result.pdfPath) {
          const bytes = await window.quireDesktop.readPdfFile(result.pdfPath);
          setPdfData(bytes);
          setError(null);
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

  return (
    <div className="app">
      <CommandPalette />
      <TopBar projectLabel={project?.label ?? "Untitled"} engineAvailable={project?.engineAvailable ?? null} />
      <div className="app__panes" ref={containerRef} style={{ gridTemplateColumns: `${splitFraction}fr var(--s-2) ${1 - splitFraction}fr` }}>
        <div className="app__pane">
          {project && (
            <Editor
              key={project.projectId}
              initialDoc={initialDoc}
              projectId={project.projectId}
              uri={project.uri}
              onChange={scheduleCompile}
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
          {error ? <pre className="app__error">{error}</pre> : <PdfViewer data={pdfData} />}
        </div>
      </div>
    </div>
  );
}
