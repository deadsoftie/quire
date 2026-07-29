import type { FileNode, FileNodeKind } from "@quire/client";

export interface TreeNode {
  name: string;
  /** Path segments joined from the project root, e.g. "/chapters/intro.tex" -- unique per node, used as a React key. */
  path: string;
  kind: FileNodeKind | "directory";
  /** Only present on file leaves -- the real absolute uri. */
  uri?: string;
  children: TreeNode[];
}

// Reconstructs a nested tree client-side from OpenProjectResponse.files' flat, dependency-graph-derived list -- same data, just organized for display, not a contract change.
export function buildFileTree(files: FileNode[], projectId: string): TreeNode[] {
  const root: TreeNode = { name: "", path: "", kind: "directory", children: [] };

  for (const file of files) {
    const relative = file.uri.startsWith(projectId) ? file.uri.slice(projectId.length) : file.uri;
    const segments = relative.split(/[\\/]/).filter(Boolean);
    if (segments.length === 0) continue;

    let node = root;
    let pathSoFar = "";
    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i];
      pathSoFar += "/" + segment;
      const isLeaf = i === segments.length - 1;

      let child = node.children.find((c) => c.name === segment);
      if (!child) {
        child = {
          name: segment,
          path: pathSoFar,
          kind: isLeaf ? file.kind : "directory",
          uri: isLeaf ? file.uri : undefined,
          children: [],
        };
        node.children.push(child);
      }
      node = child;
    }
  }

  sortTree(root.children);
  return root.children;
}

function sortTree(nodes: TreeNode[]) {
  nodes.sort((a, b) => {
    if (a.kind === "directory" && b.kind !== "directory") return -1;
    if (a.kind !== "directory" && b.kind === "directory") return 1;
    return a.name.localeCompare(b.name);
  });
  for (const node of nodes) sortTree(node.children);
}
