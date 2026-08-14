export interface Keybinding {
  key: string;
  meta?: boolean;
  shift?: boolean;
}

export interface Command {
  id: string;
  title: string;
  /** Display-only hint, e.g. "⌘O" - `keybinding` wires the actual key. */
  shortcut?: string;
  keybinding?: Keybinding;
  run: () => void;
}
