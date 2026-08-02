import { useEffect } from "react";
import { usePaletteCommands } from "./commands/CommandContext";

// Native menu items dispatch by command id over IPC; this turns an incoming id back into a run() call.
export function useMenuBridge() {
  const commands = usePaletteCommands();

  useEffect(() => {
    return window.quireDesktop.onMenuCommand((id) => {
      commands.find((c) => c.id === id)?.run();
    });
  }, [commands]);
}
