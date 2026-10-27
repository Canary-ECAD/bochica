import { createModel, getProvider, runTurn } from "@bochica/agent";
import { ChatEvent, type ChatSendRequest, ipcChannels, type TurnEvent } from "@bochica/shared";
import type { WebContents } from "electron";
import type { CredentialStore } from "./credentials";
import type { Logger } from "./logger";

/** Runs chat turns in the main process and streams their events to the window that asked. */
export class ChatService {
  private readonly running = new Map<string, AbortController>();

  constructor(
    private readonly credentials: CredentialStore,
    private readonly logger: Logger,
  ) {}

  /** Starts the turn and returns at once; events follow on `chat:event`. */
  send(request: ChatSendRequest, target: WebContents): void {
    const emit = (event: TurnEvent): void => {
      if (!target.isDestroyed()) {
        target.send(ipcChannels.chatEvent, ChatEvent.parse({ turnId: request.turnId, ...event }));
      }
    };

    const key = keyFor(request.provider, this.credentials);
    if (key === undefined) {
      emit({ type: "error", code: "missing_key", message: "No API key saved for this provider." });
      return;
    }

    const controller = new AbortController();
    this.running.set(request.turnId, controller);
    void (async () => {
      try {
        const model = createModel(request.provider, key, request.model);
        for await (const event of runTurn({
          model,
          messages: request.messages,
          abortSignal: controller.signal,
        })) {
          if (event.type === "error") {
            this.logger.error(
              `Turn failed (${request.provider}/${request.model}): ${event.code}`,
              event.message,
            );
          }
          emit(event);
        }
      } finally {
        this.running.delete(request.turnId);
      }
    })();
  }

  stop(turnId: string): void {
    this.running.get(turnId)?.abort();
  }

  stopAll(): void {
    for (const controller of this.running.values()) controller.abort();
  }
}

/** The key to call a provider with: "" for local servers, undefined when none is configured. */
export function keyFor(
  provider: ChatSendRequest["provider"],
  credentials: CredentialStore,
): string | undefined {
  return getProvider(provider).auth === "local" ? "" : credentials.resolve(provider);
}
