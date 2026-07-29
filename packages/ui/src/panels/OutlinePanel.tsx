import { useEffect, useState } from "react";
import type { OutlineNode } from "@quire/client";
// Reuses file-tree's row/name classes for the same indented-list look.
import "./FileTreePanel.css";

interface OutlinePanelProps {
  projectId: string;
  uri: string;
  /** Bumped after every successful compile to refetch; meaningless until M3's completion index exists. */
  refreshToken: number;
}

// outline() is a frozen-shape stub, always [] until M3; renders the real shape now regardless.
export function OutlinePanel({ projectId, uri, refreshToken }: OutlinePanelProps) {
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
        <OutlineItem key={index} node={node} depth={0} />
      ))}
    </ul>
  );
}

function OutlineItem({ node, depth }: { node: OutlineNode; depth: number }) {
  return (
    <li>
      <div className="file-tree__row" style={{ paddingLeft: `calc(var(--s-2) + ${depth} * var(--s-4))` }}>
        <span className="file-tree__name">{node.label}</span>
      </div>
      {node.children.length > 0 && (
        <ul>
          {node.children.map((child, index) => (
            <OutlineItem key={index} node={child} depth={depth + 1} />
          ))}
        </ul>
      )}
    </li>
  );
}
