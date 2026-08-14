import type { ExplorerNode } from "@quire/client";

export interface FlatExplorerRow {
  node: ExplorerNode;
  depth: number;
}

/**
 * Depth-first in the same order the server already sorts (directories first, then alphabetical
 * within each group) - skips a directory's children while its uri is in `collapsed`.
 */
export function flattenVisible(nodes: ExplorerNode[], collapsed: ReadonlySet<string>, depth = 0): FlatExplorerRow[] {
  const rows: FlatExplorerRow[] = [];
  for (const node of nodes) {
    rows.push({ node, depth });
    if (node.kind === "directory" && node.children && !collapsed.has(node.uri)) {
      rows.push(...flattenVisible(node.children, collapsed, depth + 1));
    }
  }
  return rows;
}

// Binary/opaque formats likely to show up in a LaTeX project - not exhaustive, just enough that
// clicking one does nothing instead of surfacing a raw "invalid UTF-8" read error. Easy to extend.
const NON_TEXT_EXTENSIONS = new Set([
  "pdf",
  "png",
  "jpg",
  "jpeg",
  "gif",
  "eps",
  "bmp",
  "webp",
  "ico",
  "woff",
  "woff2",
  "ttf",
  "otf",
  "zip",
  "gz",
  "tar",
]);

export function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot === -1 ? "" : name.slice(dot + 1).toLowerCase();
}

/** Everything not a known binary format is treated as openable plain/LaTeX text. */
export function isOpenableFile(name: string): boolean {
  return !NON_TEXT_EXTENSIONS.has(extensionOf(name));
}

/** `ExplorerNode` carries no parent reference - derived from its own uri/name instead of a tree walk. */
export function parentUriOf(node: ExplorerNode): string {
  return node.uri.slice(0, node.uri.length - node.name.length - 1);
}

/** Every `.tex` file anywhere in the tree, recursively - populates the Export dialog's root picker. */
export function collectTexFiles(nodes: ExplorerNode[]): ExplorerNode[] {
  const result: ExplorerNode[] = [];
  for (const node of nodes) {
    if (node.kind === "file" && extensionOf(node.name) === "tex") {
      result.push(node);
    } else if (node.kind === "directory" && node.children) {
      result.push(...collectTexFiles(node.children));
    }
  }
  return result;
}
