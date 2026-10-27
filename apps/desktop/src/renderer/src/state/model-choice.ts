import { type Provider, providers } from "@bochica/agent/catalog";
import type { ModelInfo } from "@bochica/shared";
import { useQueries, useQuery } from "@tanstack/react-query";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type { ModelChoice } from "./sessions";

export const credentialsKey = ["credentials"] as const;

/** The last model the user picked, remembered across restarts. */
const useStoredChoice = create<{ choice: ModelChoice | null; setChoice(c: ModelChoice): void }>()(
  persist((set) => ({ choice: null, setChoice: (choice) => set({ choice }) }), {
    name: "bochica.model-choice",
    storage: createJSONStorage(() => localStorage),
  }),
);

interface ModelGroup {
  provider: Provider;
  models: ModelInfo[];
}

export interface ModelChoiceState {
  groups: ModelGroup[];
  /** The stored choice if it is still available, otherwise the first available model. */
  choice: ModelChoice | null;
  setChoice(choice: ModelChoice): void;
  loading: boolean;
}

/**
 * Providers the user can chat with: those with a key, plus local servers that answer.
 * A provider whose model list fails is simply not offered.
 */
export function useModelChoice(): ModelChoiceState {
  const credentials = useQuery({
    queryKey: credentialsKey,
    queryFn: () => window.bochica.credentials.list(),
  });
  const candidates = providers.filter(
    (p) => p.auth === "local" || (credentials.data ?? []).some((c) => c.provider === p.id),
  );
  const lists = useQueries({
    queries: candidates.map((provider) => ({
      queryKey: ["models", provider.id],
      queryFn: () => window.bochica.models.list(provider.id),
      retry: false,
      staleTime: 5 * 60_000,
    })),
  });

  const groups = candidates
    .map((provider, i) => ({ provider, models: lists[i]?.data ?? [] }))
    .filter((group) => group.models.length > 0);

  const { choice: stored, setChoice } = useStoredChoice();
  const storedIsAvailable = groups.some(
    (g) => g.provider.id === stored?.provider && g.models.some((m) => m.id === stored.model),
  );
  const first = groups[0];
  const firstModel = first?.models[0];
  const choice =
    stored && storedIsAvailable
      ? stored
      : first && firstModel
        ? { provider: first.provider.id, model: firstModel.id }
        : null;

  return {
    groups,
    choice,
    setChoice,
    loading: credentials.isPending || lists.some((q) => q.isPending),
  };
}
