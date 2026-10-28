import { Navigate } from "@tanstack/react-router";
import { LoaderCircle, Zap } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Composer } from "@/components/composer";
import { MessageList } from "@/components/message-list";
import { RewindDialog } from "@/components/rewind-dialog";
import { TodoPanel } from "@/components/todo-panel";
import { Button } from "@/components/ui/button";
import { currentTodos } from "@/lib/todos";
import { useModelChoice } from "@/state/model-choice";
import { setPermission, usePermission } from "@/state/permission";
import {
  ensureLoaded,
  type Message,
  reloadSession,
  retry,
  sendMessage,
  stopTurn,
  useSessions,
} from "@/state/sessions";

export function SessionPage({ sessionId }: { sessionId: string }) {
  const { t } = useTranslation();
  const session = useSessions((state) => state.sessions[sessionId]);
  const permission = usePermission((state) => state.bySession[sessionId] ?? "ask");
  const { choice } = useModelChoice();
  const [missing, setMissing] = useState(false);
  const [rewinding, setRewinding] = useState<Message | null>(null);
  /** A message given back by a rewind; the key remounts the composer with it. */
  const [draft, setDraft] = useState({ text: "", key: 0 });

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
  const context = session.messages.findLast((m) => m.context)?.context;
  const todos = currentTodos(session.messages);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {permission === "auto" && (
        <div
          role="status"
          className="flex items-center gap-3 border-b border-destructive/40 bg-destructive/10 px-6 py-2 text-sm"
        >
          <Zap className="size-4 shrink-0 text-destructive" />
          <span className="min-w-0 flex-1">{t("permission.autoBar")}</span>
          <Button size="sm" variant="outline" onClick={() => setPermission(sessionId, "ask")}>
            {t("permission.turnOff")}
          </Button>
        </div>
      )}
      <MessageList
        messages={session.messages}
        onRetry={(turnId) => {
          if (choice) retry(sessionId, turnId, choice);
        }}
        onRewind={streaming ? undefined : setRewinding}
        onApprovePlan={
          permission === "plan" && !streaming && choice
            ? () => {
                setPermission(sessionId, "ask");
                sendMessage(sessionId, t("plan.goMessage"), choice);
              }
            : undefined
        }
      />
      <div className="mx-auto w-full max-w-3xl px-6 pb-6">
        {todos.length > 0 && <TodoPanel todos={todos} />}
        <Composer
          key={draft.key}
          autoFocus
          initialText={draft.text}
          context={context}
          folder={session.folder}
          permission={permission}
          onPermission={(mode) => setPermission(sessionId, mode)}
          onSend={(text, picked) => sendMessage(sessionId, text, picked)}
          onStop={streaming ? () => stopTurn(streaming.id) : undefined}
        />
      </div>
      {rewinding && (
        <RewindDialog
          sessionId={sessionId}
          messageId={rewinding.id}
          text={rewinding.content}
          folder={session.folder}
          onClose={() => setRewinding(null)}
          onDone={(restore, text) => {
            setRewinding(null);
            if (restore === "files") return;
            void reloadSession(sessionId);
            setDraft((current) => ({ text, key: current.key + 1 }));
          }}
        />
      )}
    </div>
  );
}
