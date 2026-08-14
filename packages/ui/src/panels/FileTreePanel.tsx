import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import type { DragEvent as ReactDragEvent, KeyboardEvent, MouseEvent as ReactMouseEvent } from "react";
import { BookOpen, File, FileText, Folder, FolderOpen, Image as ImageIcon, Target } from "lucide-react";
import type { ExplorerNode } from "@quire/client";
import { ContextMenu, type ContextMenuItem } from "../ContextMenu";
import { FILE_DRAG_MIME } from "../fileDrag";
import { extensionOf, flattenVisible, isOpenableFile, parentUriOf, type FlatExplorerRow } from "./explorerTree";
import "./FileTreePanel.css";

const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "eps", "bmp", "webp"]);

interface FileTreePanelProps {
  tree: ExplorerNode[];
  /** The project's root directory - the sidebar header's New File/New Folder buttons always create here. */
  rootUri: string;
  activeUri: string | null;
  /** The currently "targeted" .tex file (compiles into the preview instead of the automatically detected root), or `null` for automatic. */
  targetRoot: string | null;
  onSelectFile: (uri: string) => void;
  onCreateFile: (parentUri: string, name: string) => Promise<void>;
  onCreateDirectory: (parentUri: string, name: string) => Promise<void>;
  /** Resolves to the renamed entry's new uri, or `null` on failure - used to keep keyboard focus on the same logical row across the uri change. */
  onRename: (uri: string, newName: string) => Promise<string | null>;
  onMove: (uri: string, newParentUri: string) => Promise<void>;
  onCopy: (uri: string, destParentUri: string) => Promise<void>;
  onTrash: (uri: string) => Promise<void>;
  onReveal: (uri: string) => Promise<void>;
  /** `null` clears the target, returning to automatic root detection. */
  onRetarget: (uri: string | null) => Promise<void>;
}

/** Only a real .tex *file* can be targeted - mirrors iconFor's own early-return-on-directory guard, made explicit here since this isn't routed through that function. */
function isTargetableTexFile(node: ExplorerNode): boolean {
  return node.kind === "file" && extensionOf(node.name) === "tex";
}

export interface FileTreePanelHandle {
  startCreatingAtRoot(kind: "file" | "directory"): void;
}

interface PendingCreate {
  parentUri: string;
  kind: "file" | "directory";
}

/** `node: null` means the background was right-clicked (the project root, not a specific entry). */
interface MenuTarget {
  x: number;
  y: number;
  node: ExplorerNode | null;
}

interface Clipboard {
  uri: string;
  mode: "cut" | "copy";
}

function iconFor(node: ExplorerNode, expanded: boolean) {
  if (node.kind === "directory") return expanded ? <FolderOpen size={14} /> : <Folder size={14} />;
  const ext = extensionOf(node.name);
  if (ext === "tex") return <FileText size={14} />;
  if (ext === "bib") return <BookOpen size={14} />;
  if (IMAGE_EXTENSIONS.has(ext)) return <ImageIcon size={14} />;
  return <File size={14} />;
}

// Shared by inline rename and inline create - Enter/blur-with-a-real-change commits, Escape or an
// unchanged/empty blur cancels without ever calling the RPC underneath.
function EditableNameInput({
  initialValue,
  ariaLabel,
  onCommit,
  onCancel,
}: {
  initialValue: string;
  ariaLabel: string;
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
      aria-label={ariaLabel}
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
  ariaLabel,
  onCommit,
  onCancel,
}: {
  depth: number;
  kind: "file" | "directory";
  initialValue: string;
  ariaLabel: string;
  onCommit: (value: string) => void;
  onCancel: () => void;
}) {
  return (
    <div className="file-tree__row file-tree__row--editing" style={{ paddingLeft: `calc(var(--s-2) + ${depth} * var(--s-4))` }}>
      <span className="file-tree__icon">{kind === "directory" ? <Folder size={14} /> : <File size={14} />}</span>
      <EditableNameInput initialValue={initialValue} ariaLabel={ariaLabel} onCommit={onCommit} onCancel={onCancel} />
    </div>
  );
}

export const FileTreePanel = forwardRef<FileTreePanelHandle, FileTreePanelProps>(function FileTreePanel(
  {
    tree,
    rootUri,
    activeUri,
    targetRoot,
    onSelectFile,
    onCreateFile,
    onCreateDirectory,
    onRename,
    onMove,
    onCopy,
    onTrash,
    onReveal,
    onRetarget,
  },
  ref,
) {
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [renamingUri, setRenamingUri] = useState<string | null>(null);
  const [pendingCreate, setPendingCreate] = useState<PendingCreate | null>(null);
  const [focusedUri, setFocusedUri] = useState<string | null>(null);
  const [menuTarget, setMenuTarget] = useState<MenuTarget | null>(null);
  const [clipboard, setClipboard] = useState<Clipboard | null>(null);
  // The uri currently under a drag (a real directory's uri, or `rootUri` for the background) --
  // drives the drop-target highlight. `null` means no drag is over a valid target right now.
  const [dragOverUri, setDragOverUri] = useState<string | null>(null);
  // The uri being dragged, tracked from dragstart - `dataTransfer.getData` is only readable on
  // drop, not during dragover, so this is the only way to reject "into itself/its own descendant"
  // (a folder can't become its own child) before the drop, rather than letting the backend fail
  // it with a raw OS-level rename error.
  const [draggingUri, setDraggingUri] = useState<string | null>(null);
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

  // Restores keyboard focus to the renamed row (by its new uri, so a subsequent arrow-key press
  // continues from the same logical row) rather than leaving it wherever the now-unmounted input
  // used to be - same reasoning as closeMenu below, applied to the F2 path instead of right-click.
  async function commitRename(uri: string, newName: string) {
    setRenamingUri(null);
    const newUri = await onRename(uri, newName);
    focusRow(newUri ?? uri);
  }

  async function commitCreate(name: string) {
    const pending = pendingCreate;
    setPendingCreate(null);
    if (!pending) return;
    if (pending.kind === "file") {
      // Left unfocused deliberately: creating a file opens it in the editor, which is where
      // attention (and typing) goes next - refocusing the tree row here would fight that.
      await onCreateFile(pending.parentUri, name);
    } else {
      await onCreateDirectory(pending.parentUri, name);
      focusRow(pending.parentUri);
    }
  }

  function cancelRename() {
    const uri = renamingUri;
    setRenamingUri(null);
    if (uri) focusRow(uri);
  }

  function cancelCreate() {
    const pending = pendingCreate;
    setPendingCreate(null);
    if (pending) focusRow(pending.parentUri);
  }

  // A "Cut" clears itself after one paste (the original moved away, so it couldn't be pasted
  // again anyway); a "Copy" stays live so the same source can be pasted into several folders.
  async function paste(destParentUri: string) {
    if (!clipboard) return;
    if (clipboard.mode === "cut") {
      setClipboard(null);
      await onMove(clipboard.uri, destParentUri);
    } else {
      await onCopy(clipboard.uri, destParentUri);
    }
  }

  function handleDragStart(event: ReactDragEvent, uri: string) {
    event.dataTransfer.setData(FILE_DRAG_MIME, uri);
    // "copyMove": the row itself doesn't know its drop target yet - dropping on a directory
    // here moves the entry, dropping in the editor (Editor.tsx's own dragover) inserts a
    // reference instead. Each drop target picks its own dropEffect below/in Editor.tsx.
    event.dataTransfer.effectAllowed = "copyMove";
    setDraggingUri(uri);
  }

  function isInvalidDropTarget(targetUri: string): boolean {
    return targetUri === draggingUri || (draggingUri !== null && targetUri.startsWith(draggingUri + "/"));
  }

  // A file row always stops propagation (so the background handler below never mistakes
  // "hovering a row" for "hovering empty space") but never calls preventDefault for itself --
  // only a directory is a valid drop target, so a file correctly shows a no-drop cursor.
  function handleRowDragOver(event: ReactDragEvent, row: FlatExplorerRow) {
    if (!event.dataTransfer.types.includes(FILE_DRAG_MIME)) return;
    event.stopPropagation();
    if (row.node.kind !== "directory" || isInvalidDropTarget(row.node.uri)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    setDragOverUri(row.node.uri);
  }

  async function handleRowDrop(event: ReactDragEvent, row: FlatExplorerRow) {
    if (!event.dataTransfer.types.includes(FILE_DRAG_MIME)) return;
    event.stopPropagation();
    if (row.node.kind !== "directory" || isInvalidDropTarget(row.node.uri)) return;
    event.preventDefault();
    setDragOverUri(null);
    const draggedUri = event.dataTransfer.getData(FILE_DRAG_MIME);
    if (draggedUri && draggedUri !== row.node.uri) await onMove(draggedUri, row.node.uri);
  }

  // Only ever reached for empty space - every row already stops propagation above.
  function handleBackgroundDragOver(event: ReactDragEvent) {
    if (!event.dataTransfer.types.includes(FILE_DRAG_MIME)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    setDragOverUri(rootUri);
  }

  async function handleBackgroundDrop(event: ReactDragEvent) {
    if (!event.dataTransfer.types.includes(FILE_DRAG_MIME)) return;
    event.preventDefault();
    setDragOverUri(null);
    const draggedUri = event.dataTransfer.getData(FILE_DRAG_MIME);
    if (draggedUri) await onMove(draggedUri, rootUri);
  }

  // stopPropagation so this never also fires the row's own onClick (which opens the file) --
  // targeting and opening are independent actions. Toggle semantics: clicking the current target
  // clears it back to automatic; clicking any other .tex row replaces it.
  function handleTargetToggle(event: ReactMouseEvent, node: ExplorerNode) {
    event.stopPropagation();
    onRetarget(node.uri === targetRoot ? null : node.uri);
  }

  function openMenu(event: ReactMouseEvent, node: ExplorerNode | null) {
    event.preventDefault();
    event.stopPropagation();
    if (node) setFocusedUri(node.uri);
    setMenuTarget({ x: event.clientX, y: event.clientY, node });
  }

  // Every ContextMenu close path (Escape, Tab, outside click, a second right-click, or picking an
  // item) routes through this - without it, DOM focus silently drops to document.body once the
  // menu unmounts, leaving arrow-key navigation dead until the tree is clicked again by mouse.
  function closeMenu() {
    setMenuTarget(null);
    if (focusedUri) focusRow(focusedUri);
  }

  // Right-clicking a file targets its containing directory for New File/New Folder/Paste --
  // those always create a sibling, never a child of a file.
  function menuItemsFor(node: ExplorerNode | null): ContextMenuItem[] {
    const createParentUri = node === null ? rootUri : node.kind === "directory" ? node.uri : parentUriOf(node);

    const items: ContextMenuItem[] = [
      { id: "new-file", label: "New File", onSelect: () => setPendingCreate({ parentUri: createParentUri, kind: "file" }) },
      {
        id: "new-folder",
        label: "New Folder",
        onSelect: () => setPendingCreate({ parentUri: createParentUri, kind: "directory" }),
      },
    ];

    // Grouped with "acts on this file's identity" (right after creation, its own separator)
    // rather than with the structural cut/copy/move group below - targeting isn't a filesystem
    // mutation the way those are.
    if (node && isTargetableTexFile(node)) {
      const isTarget = node.uri === targetRoot;
      items.push({
        id: "target",
        label: isTarget ? "Clear Root Target" : "Set as Root Target",
        separatorBefore: true,
        onSelect: () => onRetarget(isTarget ? null : node.uri),
      });
    }

    if (node) {
      items.push(
        { id: "rename", label: "Rename", separatorBefore: true, onSelect: () => setRenamingUri(node.uri) },
        { id: "cut", label: "Cut", onSelect: () => setClipboard({ uri: node.uri, mode: "cut" }) },
        { id: "copy", label: "Copy", onSelect: () => setClipboard({ uri: node.uri, mode: "copy" }) },
      );
    }

    items.push({
      id: "paste",
      label: "Paste",
      separatorBefore: node === null,
      disabled: !clipboard,
      onSelect: () => paste(createParentUri),
    });

    items.push({
      id: "delete",
      label: "Delete",
      separatorBefore: true,
      destructive: node !== null,
      disabled: node === null,
      onSelect: () => node && onTrash(node.uri),
    });
    items.push({
      id: "reveal",
      label: "Reveal in File Manager",
      onSelect: () => onReveal(node ? node.uri : rootUri),
    });

    return items;
  }

  return (
    // Right-click here only ever fires when a row's own handler hasn't already stopped
    // propagation - i.e. the click landed on empty space below/around the rows - meaning "create
    // at the project root," the same default the old native "New File" dialog always used.
    <div
      className={"file-tree__container" + (dragOverUri === rootUri ? " file-tree__container--drag-over" : "")}
      onContextMenu={(event) => openMenu(event, null)}
      onDragOver={handleBackgroundDragOver}
      onDrop={handleBackgroundDrop}
    >
      {tree.length === 0 && !pendingCreate ? (
        <p className="panel-empty">This folder is empty.</p>
      ) : (
        <ul className="file-tree" role="tree" aria-label="Explorer">
          {pendingCreate && pendingCreate.parentUri === rootUri && (
            // role="presentation": the <ul> is a tree, not a list, once role="tree" is applied --
            // its <li> children shouldn't carry the browser's default "listitem" role alongside
            // the real treeitem/none roles below (same fix ContextMenu's own <li> already needed).
            <li role="presentation">
              <EditableNameRow
                depth={0}
                kind={pendingCreate.kind}
                initialValue=""
                ariaLabel={pendingCreate.kind === "file" ? "New file name" : "New folder name"}
                onCommit={commitCreate}
                onCancel={cancelCreate}
              />
            </li>
          )}
          {rows.map((row, index) => (
            <li key={row.node.uri} role="presentation">
              {renamingUri === row.node.uri ? (
                <EditableNameRow
                  depth={row.depth}
                  kind={row.node.kind}
                  initialValue={row.node.name}
                  ariaLabel={`Rename ${row.node.name}`}
                  onCommit={(name) => commitRename(row.node.uri, name)}
                  onCancel={cancelRename}
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
                    (row.node.kind === "file" && !isOpenableFile(row.node.name) ? " file-tree__row--inert" : "") +
                    (row.node.uri === dragOverUri ? " file-tree__row--drag-over" : "")
                  }
                  style={{ paddingLeft: `calc(var(--s-2) + ${row.depth} * var(--s-4))` }}
                  role="treeitem"
                  aria-level={row.depth + 1}
                  aria-expanded={row.node.kind === "directory" ? !collapsed.has(row.node.uri) : undefined}
                  aria-selected={row.node.uri === activeUri}
                  tabIndex={row.node.uri === focusedUri ? 0 : -1}
                  draggable
                  onDragStart={(event) => handleDragStart(event, row.node.uri)}
                  onDragOver={(event) => handleRowDragOver(event, row)}
                  onDrop={(event) => handleRowDrop(event, row)}
                  onDragEnd={() => {
                    setDragOverUri(null);
                    setDraggingUri(null);
                  }}
                  onClick={() => handleRowClick(row)}
                  onKeyDown={(event) => handleRowKeyDown(event, row, index)}
                  onContextMenu={(event) => openMenu(event, row.node)}
                >
                  <span className="file-tree__icon">{iconFor(row.node, !collapsed.has(row.node.uri))}</span>
                  <span className="file-tree__name">{row.node.name}</span>
                  {isTargetableTexFile(row.node) && (
                    <button
                      type="button"
                      className={
                        "file-tree__target-toggle" +
                        (row.node.uri === targetRoot ? " file-tree__target-toggle--active" : "")
                      }
                      aria-label={
                        row.node.uri === targetRoot
                          ? `Clear root target (currently ${row.node.name})`
                          : `Set ${row.node.name} as root target`
                      }
                      aria-pressed={row.node.uri === targetRoot}
                      onClick={(event) => handleTargetToggle(event, row.node)}
                    >
                      <Target size={13} />
                    </button>
                  )}
                </div>
              )}
              {pendingCreate && pendingCreate.parentUri === row.node.uri && (
                <EditableNameRow
                  depth={row.depth + 1}
                  kind={pendingCreate.kind}
                  initialValue=""
                  ariaLabel={pendingCreate.kind === "file" ? "New file name" : "New folder name"}
                  onCommit={commitCreate}
                  onCancel={cancelCreate}
                />
              )}
            </li>
          ))}
        </ul>
      )}
      {menuTarget && (
        <ContextMenu
          x={menuTarget.x}
          y={menuTarget.y}
          items={menuItemsFor(menuTarget.node)}
          onClose={closeMenu}
        />
      )}
    </div>
  );
});
