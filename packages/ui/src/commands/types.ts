export interface Keybinding {
  key: string;
  meta?: boolean;
  shift?: boolean;
}

export interface Command {
  id: string;
  title: string;
  /** Display-only hint shown in the palette, e.g. "⌘O". Doesn't do
   * anything on its own -- `keybinding` is what actually wires the key. */
  shortcut?: string;
  keybinding?: Keybinding;
  run: () => void;
}
