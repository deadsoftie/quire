import { Prec } from "@codemirror/state";
import type { Extension } from "@codemirror/state";
import { keymap } from "@codemirror/view";

// Highest precedence so these run before basicSetup's own searchKeymap would open CM6's stock panel.
// Mod-f/Mod-Alt-f open FindWidget directly rather than just swallowing the key: a plain `run: () => true`
// (no-op besides marking handled) still calls preventDefault, which also suppresses the native Electron
// menu accelerator for the same key when the editor has focus, so relying on that round trip alone
// left ⌘F dead while typing - this makes the keymap itself the trigger for that case.
export function neutralizeDefaultSearchKeymap(onOpen: (withReplace: boolean) => void): Extension {
  return Prec.highest(
    keymap.of([
      {
        key: "Mod-f",
        run: () => {
          onOpen(false);
          return true;
        },
      },
      {
        key: "Mod-Alt-f",
        run: () => {
          onOpen(true);
          return true;
        },
      },
      { key: "Mod-g", run: () => true },
      { key: "Shift-Mod-g", run: () => true },
    ]),
  );
}
