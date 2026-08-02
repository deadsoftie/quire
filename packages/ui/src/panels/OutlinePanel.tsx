import { useEffect, useState } from "react";
import type { OutlineNode } from "@quire/client";
// Reuses file-tree's row/name classes for the same indented-list look.
import "./FileTreePanel.css";

interface OutlinePanelProps {
  projectId: string;
  uri: string;
  /** Bumped after every successful compile to refetch; reads from disk, so it only reflects the last saved content, not unsaved edits. */
  refreshToken: number;
  onSelectNode: (node: OutlineNode) => void;
}

export function OutlinePanel({ projectId, uri, refreshToken, onSelectNode }: OutlinePanelProps) {
  const [nodes, setNodes] = useState<OutlineNode[]>([]);

  useEffect(() => {
    if (!projectId || !uri) return;
    let cancelled = false;
    window.quire.outline(projectId, uri).then((result) => {
      if (!cancelled) setNodes(result);
    });
    return () => {
      cancelled = true;
    };
  }, [projectId, uri, refreshToken]);

  if (nodes.length === 0) {
    return <p className="panel-empty">No outline yet.</p>;
  }

  return (
    <ul className="outline-panel">
      {nodes.map((node, index) => (
        <OutlineItem key={index} node={node} depth={0} onSelectNode={onSelectNode} />
      ))}
    </ul>
  );
}

function OutlineItem({
  node,
  depth,
  onSelectNode,
}: {
  node: OutlineNode;
  depth: number;
  onSelectNode: (node: OutlineNode) => void;
}) {
  return (
    <li>
      <div
        className="file-tree__row file-tree__row--selectable"
        style={{ paddingLeft: `calc(var(--s-2) + ${depth} * var(--s-4))` }}
        onClick={() => onSelectNode(node)}
      >
        <span className="file-tree__name">{node.label}</span>
      </div>
      {node.children.length > 0 && (
        <ul>
          {node.children.map((child, index) => (
            <OutlineItem key={index} node={child} depth={depth + 1} onSelectNode={onSelectNode} />
          ))}
        </ul>
      )}
    </li>
  );
}
