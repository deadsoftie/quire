import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { BookOpen, File, FileText, Folder, FolderOpen, Image as ImageIcon } from "lucide-react";
import type { ExplorerNode } from "@quire/client";
import { extensionOf, flattenVisible, isOpenableFile, type FlatExplorerRow } from "./explorerTree";
import "./FileTreePanel.css";

const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "eps", "bmp", "webp"]);

interface FileTreePanelProps {
  tree: ExplorerNode[];
  /** The project's root directory -- the sidebar header's New File/New Folder buttons always create here. */
  rootUri: string;
  activeUri: string | null;
  onSelectFile: (uri: string) => void;
  onCreateFile: (parentUri: string, name: string) => Promise<void>;
  onCreateDirectory: (parentUri: string, name: string) => Promise<void>;
  onRename: (uri: string, newName: string) => Promise<void>;
  onTrash: (uri: string) => Promise<void>;
}

export interface FileTreePanelHandle {
  startCreatingAtRoot(kind: "file" | "directory"): void;
}

interface PendingCreate {
  parentUri: string;
  kind: "file" | "directory";
}

function iconFor(node: ExplorerNode, expanded: boolean) {
  if (node.kind === "directory") return expanded ? <FolderOpen size={14} /> : <Folder size={14} />;
  const ext = extensionOf(node.name);
  if (ext === "tex") return <FileText size={14} />;
  if (ext === "bib") return <BookOpen size={14} />;
  if (IMAGE_EXTENSIONS.has(ext)) return <ImageIcon size={14} />;
  return <File size={14} />;
}

// Shared by inline rename and inline create -- Enter/blur-with-a-real-change commits, Escape or an
// unchanged/empty blur cancels without ever calling the RPC underneath.
function EditableNameInput({
  initialValue,
  onCommit,
  onCancel,
}: {
  initialValue: string;
  onCommit: (value: string) => void;
  onCancel: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    input.focus();
    // Selects the name minus its extension, matching every other editor's rename convention.
    const dot = initialValue.lastIndexOf(".");
    input.setSelectionRange(0, dot > 0 ? dot : initialValue.length);
  }, [initialValue]);

  function settle() {
    const value = inputRef.current?.value.trim() ?? "";
    if (value && value !== initialValue) onCommit(value);
    else onCancel();
  }

  return (
    <input
      ref={inputRef}
      className="file-tree__name-input"
      defaultValue={initialValue}
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        // Stopped so the tree's own row-navigation handler (arrows, F2, Delete, ...) never fires while typing a name.
        event.stopPropagation();
        if (event.key === "Enter") {
          event.preventDefault();
          settle();
        } else if (event.key === "Escape") {
          event.preventDefault();
          onCancel();
        }
      }}
      onBlur={settle}
    />
  );
}

function EditableNameRow({
  depth,
  kind,
  initialValue,
  onCommit,
  onCancel,
}: {
  depth: number;
  kind: "file" | "directory";
  initialValue: string;
  onCommit: (value: string) => void;
  onCancel: () => void;
}) {
  return (
    <div className="file-tree__row file-tree__row--editing" style={{ paddingLeft: `calc(var(--s-2) + ${depth} * var(--s-4))` }}>
      <span className="file-tree__icon">{kind === "directory" ? <Folder size={14} /> : <File size={14} />}</span>
      <EditableNameInput initialValue={initialValue} onCommit={onCommit} onCancel={onCancel} />
    </div>
  );
}

export const FileTreePanel = forwardRef<FileTreePanelHandle, FileTreePanelProps>(function FileTreePanel(
  { tree, rootUri, activeUri, onSelectFile, onCreateFile, onCreateDirectory, onRename, onTrash },
  ref,
) {
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [renamingUri, setRenamingUri] = useState<string | null>(null);
  const [pendingCreate, setPendingCreate] = useState<PendingCreate | null>(null);
  const [focusedUri, setFocusedUri] = useState<string | null>(null);
  const rowRefs = useRef(new Map<string, HTMLDivElement>());

  const rows = useMemo(() => flattenVisible(tree, collapsed), [tree, collapsed]);

  // Keeps the roving tabIndex pointed at a real row across a tree refresh (a rename/create/trash
  // changing which uris exist), rather than silently pointing at nothing.
  useEffect(() => {
    if (focusedUri && rows.some((r) => r.node.uri === focusedUri)) return;
    setFocusedUri(rows[0]?.node.uri ?? null);
  }, [rows, focusedUri]);

  useImperativeHandle(
    ref,
    () => ({
      startCreatingAtRoot(kind) {
        setPendingCreate({ parentUri: rootUri, kind });
      },
    }),
    [rootUri],
  );

  function toggleExpand(uri: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(uri)) next.delete(uri);
      else next.add(uri);
      return next;
    });
  }

  function focusRow(uri: string) {
    setFocusedUri(uri);
    rowRefs.current.get(uri)?.focus();
  }

  function handleRowClick(row: FlatExplorerRow) {
    setFocusedUri(row.node.uri);
    if (row.node.kind === "directory") toggleExpand(row.node.uri);
    else if (isOpenableFile(row.node.name)) onSelectFile(row.node.uri);
  }

  function handleRowKeyDown(event: KeyboardEvent<HTMLDivElement>, row: FlatExplorerRow, index: number) {
    switch (event.key) {
      case "ArrowDown": {
        event.preventDefault();
        const next = rows[index + 1];
        if (next) focusRow(next.node.uri);
        break;
      }
      case "ArrowUp": {
        event.preventDefault();
        const prev = rows[index - 1];
        if (prev) focusRow(prev.node.uri);
        break;
      }
      case "ArrowRight": {
        if (row.node.kind !== "directory") break;
        event.preventDefault();
        if (collapsed.has(row.node.uri)) {
          toggleExpand(row.node.uri);
        } else {
          const next = rows[index + 1];
          if (next && next.depth > row.depth) focusRow(next.node.uri);
        }
        break;
      }
      case "ArrowLeft": {
        event.preventDefault();
        if (row.node.kind === "directory" && !collapsed.has(row.node.uri)) {
          toggleExpand(row.node.uri);
        } else {
          for (let i = index - 1; i >= 0; i--) {
            if (rows[i].depth < row.depth) {
              focusRow(rows[i].node.uri);
              break;
            }
          }
        }
        break;
      }
      case "Enter": {
        event.preventDefault();
        if (row.node.kind === "directory") toggleExpand(row.node.uri);
        else if (isOpenableFile(row.node.name)) onSelectFile(row.node.uri);
        break;
      }
      case "F2": {
        event.preventDefault();
        setRenamingUri(row.node.uri);
        break;
      }
      case "Delete":
      case "Backspace": {
        event.preventDefault();
        onTrash(row.node.uri);
        break;
      }
    }
  }

  async function commitRename(uri: string, newName: string) {
    setRenamingUri(null);
    await onRename(uri, newName);
  }

  async function commitCreate(name: string) {
    const pending = pendingCreate;
    setPendingCreate(null);
    if (!pending) return;
    if (pending.kind === "file") await onCreateFile(pending.parentUri, name);
    else await onCreateDirectory(pending.parentUri, name);
  }

  if (tree.length === 0 && !pendingCreate) {
    return <p className="panel-empty">This folder is empty.</p>;
  }

  return (
    <ul className="file-tree" role="tree" aria-label="Explorer">
      {pendingCreate && pendingCreate.parentUri === rootUri && (
        <li>
          <EditableNameRow
            depth={0}
            kind={pendingCreate.kind}
            initialValue=""
            onCommit={commitCreate}
            onCancel={() => setPendingCreate(null)}
          />
        </li>
      )}
      {rows.map((row, index) => (
        <li key={row.node.uri}>
          {renamingUri === row.node.uri ? (
            <EditableNameRow
              depth={row.depth}
              kind={row.node.kind}
              initialValue={row.node.name}
              onCommit={(name) => commitRename(row.node.uri, name)}
              onCancel={() => setRenamingUri(null)}
            />
          ) : (
            <div
              ref={(el) => {
                if (el) rowRefs.current.set(row.node.uri, el);
                else rowRefs.current.delete(row.node.uri);
              }}
              className={
                "file-tree__row" +
                (row.node.kind === "directory" || isOpenableFile(row.node.name) ? " file-tree__row--selectable" : "") +
                (row.node.uri === activeUri ? " file-tree__row--active" : "") +
                (row.node.kind === "file" && !isOpenableFile(row.node.name) ? " file-tree__row--inert" : "")
              }
              style={{ paddingLeft: `calc(var(--s-2) + ${row.depth} * var(--s-4))` }}
              role="treeitem"
              aria-level={row.depth + 1}
              aria-expanded={row.node.kind === "directory" ? !collapsed.has(row.node.uri) : undefined}
              aria-selected={row.node.uri === activeUri}
              tabIndex={row.node.uri === focusedUri ? 0 : -1}
              onClick={() => handleRowClick(row)}
              onKeyDown={(event) => handleRowKeyDown(event, row, index)}
            >
              <span className="file-tree__icon">{iconFor(row.node, !collapsed.has(row.node.uri))}</span>
              <span className="file-tree__name">{row.node.name}</span>
            </div>
          )}
          {pendingCreate && pendingCreate.parentUri === row.node.uri && (
            <EditableNameRow
              depth={row.depth + 1}
              kind={pendingCreate.kind}
              initialValue=""
              onCommit={commitCreate}
              onCancel={() => setPendingCreate(null)}
            />
          )}
        </li>
      ))}
    </ul>
  );
});
