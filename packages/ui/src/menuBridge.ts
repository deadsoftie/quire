import { useEffect } from "react";
import { usePaletteCommands } from "./commands/CommandContext";

// Native menu items (apps/desktop/src/main.js) dispatch by command id over IPC rather than
// duplicating each action's logic -- this is the one place that turns an incoming id back into a
// run() call, reusing the exact same registry the command palette already lists from.
export function useMenuBridge() {
  const commands = usePaletteCommands();

  useEffect(() => {
    return window.quireDesktop.onMenuCommand((id) => {
      commands.find((c) => c.id === id)?.run();
    });
  }, [commands]);
}
