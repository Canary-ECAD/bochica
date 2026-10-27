import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

/**
 * The working folder for the next new session; the last one picked is remembered across
 * restarts. Null means Bochica's default (Documents\Bochica).
 */
export const useFolder = create<{ folder: string | null; setFolder(folder: string): void }>()(
  persist((set) => ({ folder: null, setFolder: (folder) => set({ folder }) }), {
    name: "bochica.folder",
    storage: createJSONStorage(() => localStorage),
  }),
);
