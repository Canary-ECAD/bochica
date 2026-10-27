import { Navigate } from "@tanstack/react-router";
import { LoaderCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { Composer } from "@/components/composer";
import { MessageList } from "@/components/message-list";
import { useModelChoice } from "@/state/model-choice";
import { ensureLoaded, retry, sendMessage, stopTurn, useSessions } from "@/state/sessions";

export function SessionPage({ sessionId }: { sessionId: string }) {
  const session = useSessions((state) => state.sessions[sessionId]);
  const { choice } = useModelChoice();
  const [missing, setMissing] = useState(false);

  // Saved sessions open with their messages loaded from disk the first time.
  const loaded = session?.loaded ?? false;
  useEffect(() => {
    if (loaded) return;
    let cancelled = false;
    void ensureLoaded(sessionId).then((found) => {
      if (!cancelled && !found) setMissing(true);
    });
    return () => {
      cancelled = true;
    };
  }, [sessionId, loaded]);

  if (missing) return <Navigate to="/" />;
  if (!session?.loaded) {
    return (
      <div className="flex flex-1 items-center justify-center text-muted-foreground">
        <LoaderCircle className="size-5 animate-spin" />
      </div>
    );
  }

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
          folder={session.folder}
          onSend={(text, picked) => sendMessage(sessionId, text, picked)}
          onStop={streaming ? () => stopTurn(streaming.id) : undefined}
        />
      </div>
    </div>
  );
}
