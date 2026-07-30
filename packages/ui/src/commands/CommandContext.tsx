import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { Command } from "./types";

interface CommandRegistry {
  commands: Command[];
  register: (command: Command) => () => void;
  paletteOpen: boolean;
  openPalette: () => void;
  closePalette: () => void;
}

const CommandContext = createContext<CommandRegistry | null>(null);

function useCommandRegistryValue(): CommandRegistry {
  const ctx = useContext(CommandContext);
  if (!ctx) throw new Error("useCommand/useCommandRegistry must be used inside a CommandProvider");
  return ctx;
}

export function CommandProvider({ children }: { children: ReactNode }) {
  const [commands, setCommands] = useState<Command[]>([]);
  const [paletteOpen, setPaletteOpen] = useState(false);

  // Mirrors for the one keydown listener below, installed once on mount.
  const commandsRef = useRef(commands);
  commandsRef.current = commands;
  const paletteOpenRef = useRef(paletteOpen);
  paletteOpenRef.current = paletteOpen;

  const register = useCallback((command: Command) => {
    setCommands((prev) => [...prev.filter((c) => c.id !== command.id), command]);
    return () => setCommands((prev) => prev.filter((c) => c.id !== command.id));
  }, []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const meta = event.metaKey || event.ctrlKey;

      if (meta && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPaletteOpen((open) => !open);
        return;
      }

      if (paletteOpenRef.current) return;

      for (const command of commandsRef.current) {
        const kb = command.keybinding;
        if (!kb) continue;
        if (kb.key.toLowerCase() !== event.key.toLowerCase()) continue;
        if ((kb.meta ?? false) !== meta) continue;
        if ((kb.shift ?? false) !== event.shiftKey) continue;

        event.preventDefault();
        command.run();
        return;
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const value: CommandRegistry = {
    commands,
    register,
    paletteOpen,
    openPalette: () => setPaletteOpen(true),
    closePalette: () => setPaletteOpen(false),
  };

  return <CommandContext.Provider value={value}>{children}</CommandContext.Provider>;
}

export function useCommandRegistry() {
  const ctx = useCommandRegistryValue();
  return { paletteOpen: ctx.paletteOpen, openPalette: ctx.openPalette, closePalette: ctx.closePalette };
}

export function usePaletteCommands() {
  return useCommandRegistryValue().commands;
}

// `run` doesn't need a stable identity across renders -- it's always invoked through a ref to the latest closure.
export function useCommand(command: Command) {
  const { register } = useCommandRegistryValue();
  const runRef = useRef(command.run);
  runRef.current = command.run;

  const { id, title, shortcut, keybinding } = command;
  useEffect(() => {
    return register({ id, title, shortcut, keybinding, run: () => runRef.current() });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, title, shortcut, keybinding?.key, keybinding?.meta, keybinding?.shift, register]);
}
