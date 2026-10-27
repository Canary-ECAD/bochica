import { Navigate } from "@tanstack/react-router";
import { Composer } from "@/components/composer";
import { MessageList } from "@/components/message-list";
import { useModelChoice } from "@/state/model-choice";
import { retry, sendMessage, stopTurn, useSessions } from "@/state/sessions";

export function SessionPage({ sessionId }: { sessionId: string }) {
  const session = useSessions((state) => state.sessions[sessionId]);
  const { choice } = useModelChoice();

  if (!session) return <Navigate to="/" />;

  const streaming = session.messages.find((m) => m.status === "streaming");

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <MessageList
        messages={session.messages}
        onRetry={(turnId) => {
          if (choice) retry(sessionId, turnId, choice);
        }}
      />
      <div className="mx-auto w-full max-w-3xl px-6 pb-6">
        <Composer
          autoFocus
          onSend={(text, picked) => sendMessage(sessionId, text, picked)}
          onStop={streaming ? () => stopTurn(streaming.id) : undefined}
        />
      </div>
    </div>
  );
}
