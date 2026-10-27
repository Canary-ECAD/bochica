import type { ChatMode } from "@bochica/shared";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

/** The mode for the next message; the last one used is remembered across restarts. */
export const useMode = create<{ mode: ChatMode; setMode(mode: ChatMode): void }>()(
  persist((set) => ({ mode: "consult", setMode: (mode) => set({ mode }) }), {
    name: "bochica.mode",
    storage: createJSONStorage(() => localStorage),
  }),
);
