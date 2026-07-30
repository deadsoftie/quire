import { EditorState, Transaction } from "@codemirror/state";
import type { ChangeSpec, Extension } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";
import type { SyntaxNode, Tree } from "@lezer/common";

// Task 3.9: 2.1's grammar deliberately doesn't enforce that a \begin{foo}/\end{bar} pair share a
// name -- Environment/MathEnvironment/VerbatimEnvironment nodes just hold two EnvName-family
// children, first the begin's, then the end's, in document order, with no check that they match
// (latex.grammar). This extension makes that pairing a live-editing behavior instead: editing
// either name mirrors the same replacement into the other, in the *same* transaction (one undo
// step), via `transactionFilter` -- not a follow-up `view.dispatch()`, which would show up as a
// second, separate undo entry for what the user experiences as one edit.
const ENV_NAME_NODE_NAMES = new Set(["EnvName", "MathEnvName", "VerbatimEnvName"]);

// A pure insertion (`fromA === toA`) sitting exactly at a name's end boundary (cursor right after
// the last letter, before the closing `}`) resolves, with `side: 1`, into whatever token *starts*
// there instead -- the `}`, not the name. Falling back to `side: -1` (prefers the token that
// *ends* at this position) recovers that case; the start boundary doesn't need a fallback, since
// `side: 1` already prefers the name there (it's what starts at that position).
function resolveEnvName(tree: Tree, pos: number): SyntaxNode {
  const forward = tree.resolveInner(pos, 1);
  if (ENV_NAME_NODE_NAMES.has(forward.name)) return forward;
  const backward = tree.resolveInner(pos, -1);
  return ENV_NAME_NODE_NAMES.has(backward.name) ? backward : forward;
}

// `null` covers every "don't mirror" case on purpose, including ones a more clever version could
// handle (multi-range edits, edits that partially spill outside the name) -- staying conservative
// here just means this transaction passes through unmirrored, never a wrong or partial mirror.
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

  // The edit sits entirely inside `node`'s old span (just checked above), so `node`'s new span is
  // just its old span grown/shrunk by the edit's own length delta -- no position mapping needed.
  const delta = toB - fromB - (toA - fromA);
  const newText = tr.newDoc.sliceString(node.from, node.to + delta);
  const oldSiblingText = tr.startState.doc.sliceString(sibling.from, sibling.to);
  if (newText === oldSiblingText) return null; // already in sync, e.g. re-typing the same text

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
      // Sibling's `from`/`to` are old-document positions, same as `mirror` above -- left
      // non-sequential (the default) so CM6 composes it against the first spec itself rather than
      // this code re-deriving post-edit coordinates by hand.
      { changes: mirror },
    ];
  });
}
