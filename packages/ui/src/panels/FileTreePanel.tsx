import { useState } from "react";
import type { TreeNode } from "./fileTree";
import "./FileTreePanel.css";

interface FileTreePanelProps {
  tree: TreeNode[];
  activeUri: string | null;
  onSelectFile: (uri: string) => void;
}

export function FileTreePanel({ tree, activeUri, onSelectFile }: FileTreePanelProps) {
  if (tree.length === 0) {
    return <p className="panel-empty">No files in this project's graph yet.</p>;
  }

  return (
    <ul className="file-tree">
      {tree.map((node) => (
        <FileTreeItem key={node.path} node={node} depth={0} activeUri={activeUri} onSelectFile={onSelectFile} />
      ))}
    </ul>
  );
}

function FileTreeItem({
  node,
  depth,
  activeUri,
  onSelectFile,
}: {
  node: TreeNode;
  depth: number;
  activeUri: string | null;
  onSelectFile: (uri: string) => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const isDirectory = node.kind === "directory";
  // Graphics show in the tree but have nothing to open them into yet.
  const isSelectable = node.kind === "tex";

  return (
    <li>
      <div
        className={
          "file-tree__row" +
          (isSelectable ? " file-tree__row--selectable" : "") +
          (node.uri && node.uri === activeUri ? " file-tree__row--active" : "") +
          (node.kind === "graphic" ? " file-tree__row--inert" : "")
        }
        style={{ paddingLeft: `calc(var(--s-2) + ${depth} * var(--s-4))` }}
        onClick={() => {
          if (isDirectory) setExpanded((e) => !e);
          else if (isSelectable && node.uri) onSelectFile(node.uri);
        }}
      >
        <span className="file-tree__disclosure">{isDirectory ? (expanded ? "▾" : "▸") : ""}</span>
        <span className="file-tree__name">{node.name}</span>
      </div>
      {isDirectory && expanded && node.children.length > 0 && (
        <ul>
          {node.children.map((child) => (
            <FileTreeItem key={child.path} node={child} depth={depth + 1} activeUri={activeUri} onSelectFile={onSelectFile} />
          ))}
        </ul>
      )}
    </li>
  );
}
