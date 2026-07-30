import { EditorState, Transaction } from "@codemirror/state";
import type { ChangeSpec, Extension } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";
import type { SyntaxNode, Tree } from "@lezer/common";

const ENV_NAME_NODE_NAMES = new Set(["EnvName", "MathEnvName", "VerbatimEnvName"]);

// side: 1 resolves a pure insertion at a name's end boundary into whatever token *starts*
// there (the closing `}`), not the name; side: -1 (prefers the token that *ends* there) recovers
// that case.
function resolveEnvName(tree: Tree, pos: number): SyntaxNode {
  const forward = tree.resolveInner(pos, 1);
  if (ENV_NAME_NODE_NAMES.has(forward.name)) return forward;
  const backward = tree.resolveInner(pos, -1);
  return ENV_NAME_NODE_NAMES.has(backward.name) ? backward : forward;
}

function mirrorEdit(tr: Transaction): ChangeSpec | null {
  const changed: { fromA: number; toA: number; fromB: number; toB: number }[] = [];
  tr.changes.iterChangedRanges((fromA, toA, fromB, toB) => changed.push({ fromA, toA, fromB, toB }));
  if (changed.length !== 1) return null;
  const { fromA, toA, fromB, toB } = changed[0];

  const node = resolveEnvName(syntaxTree(tr.startState), fromA);
  if (!ENV_NAME_NODE_NAMES.has(node.name) || fromA < node.from || toA > node.to) return null;

  const envNode = node.parent;
  if (!envNode) return null;
  const pair = envNode.getChildren(node.type.id);
  if (pair.length !== 2) return null;
  // Lezer hands out fresh SyntaxNode wrapper objects per call, so `pair[0] === node` is never
  // reliably true even when they point at the same tree position -- compare by position instead.
  const sibling = pair[0].from === node.from ? pair[1] : pair[0];
  if (sibling.from === node.from) return null;

  const delta = toB - fromB - (toA - fromA);
  const newText = tr.newDoc.sliceString(node.from, node.to + delta);
  const oldSiblingText = tr.startState.doc.sliceString(sibling.from, sibling.to);
  if (newText === oldSiblingText) return null;

  return { from: sibling.from, to: sibling.to, insert: newText };
}

export function environmentSync(): Extension {
  return EditorState.transactionFilter.of((tr) => {
    if (!tr.docChanged) return tr;
    const mirror = mirrorEdit(tr);
    if (!mirror) return tr;
    return [
      // Rebuilt rather than passed through as `tr` itself: `Transaction` has no public `.annotations`
      // (only per-type `.annotation()` lookup), so passing `tr` as a spec would silently drop its
      // `userEvent` -- history's undo-grouping keys off exactly that annotation.
      {
        changes: tr.changes,
        selection: tr.selection,
        effects: tr.effects,
        scrollIntoView: tr.scrollIntoView,
        userEvent: tr.annotation(Transaction.userEvent),
      },
      { changes: mirror },
    ];
  });
}
