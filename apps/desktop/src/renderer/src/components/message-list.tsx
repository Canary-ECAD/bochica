import { Link } from "@tanstack/react-router";
import { ArrowDown, CircleAlert, RotateCcw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Markdown } from "@/components/markdown";
import { Button } from "@/components/ui/button";
import type { Message } from "@/state/sessions";

/** Distance from the bottom, in px, within which new text keeps the view pinned. */
const STICK_THRESHOLD = 48;

export function MessageList({
  messages,
  onRetry,
}: {
  messages: Message[];
  onRetry(turnId: string): void;
}) {
  const { t } = useTranslation();
  const scroller = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const [pinned, setPinnedState] = useState(true);
  // Mirror for the ResizeObserver callback, which must not re-subscribe on every change.
  const pinnedRef = useRef(true);
  const setPinned = (value: boolean): void => {
    pinnedRef.current = value;
    setPinnedState(value);
  };

  // Follow the content as it grows while pinned; stop once the user scrolls up to read.
  useEffect(() => {
    const element = scroller.current;
    const inner = content.current;
    if (!element || !inner) return;
    const observer = new ResizeObserver(() => {
      if (pinnedRef.current) element.scrollTop = element.scrollHeight;
    });
    observer.observe(inner);
    return () => observer.disconnect();
  }, []);

  const jumpToLatest = (): void => {
    const element = scroller.current;
    element?.scrollTo({ top: element.scrollHeight, behavior: "smooth" });
    setPinned(true);
  };

  return (
    <div className="relative min-h-0 flex-1">
      <div
        ref={scroller}
        className="h-full overflow-y-auto"
        onScroll={(event) => {
          const element = event.currentTarget;
          setPinned(
            element.scrollHeight - element.scrollTop - element.clientHeight < STICK_THRESHOLD,
          );
        }}
      >
        <div ref={content} className="mx-auto flex max-w-3xl flex-col gap-6 px-6 py-8">
          {messages.map((message) =>
            message.role === "user" ? (
              <div
                key={message.id}
                className="ml-auto max-w-[85%] rounded-xl bg-muted px-4 py-2.5 text-sm whitespace-pre-wrap"
              >
                {message.content}
              </div>
            ) : (
              <AssistantMessage key={message.id} message={message} onRetry={onRetry} />
            ),
          )}
        </div>
      </div>
      {!pinned && (
        <Button
          variant="outline"
          size="sm"
          onClick={jumpToLatest}
          className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full shadow-sm"
        >
          <ArrowDown />
          {t("chat.jumpToLatest")}
        </Button>
      )}
    </div>
  );
}

function AssistantMessage({
  message,
  onRetry,
}: {
  message: Message;
  onRetry(turnId: string): void;
}) {
  const { t } = useTranslation();

  if (message.status === "streaming" && !message.content) {
    return (
      <div className="flex items-center gap-1.5 text-sm text-muted-foreground" aria-live="polite">
        <span className="size-1.5 animate-pulse rounded-full bg-current" />
        {t("chat.thinking")}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {message.content && <Markdown>{message.content}</Markdown>}
      {message.status === "stopped" && (
        <p className="text-xs text-muted-foreground">{t("chat.stopped")}</p>
      )}
      {message.status === "length" && (
        <p className="text-xs text-muted-foreground">{t("chat.cutOff")}</p>
      )}
      {message.status === "error" && message.error && (
        <ErrorNotice
          code={message.error.code}
          details={message.error.message}
          onRetry={() => onRetry(message.id)}
        />
      )}
    </div>
  );
}

function ErrorNotice({
  code,
  details,
  onRetry,
}: {
  code: NonNullable<Message["error"]>["code"];
  details: string;
  onRetry(): void;
}) {
  const { t } = useTranslation();
  const needsSettings = code === "missing_key" || code === "invalid_key";

  return (
    <div
      className="flex flex-col gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-3"
      role="alert"
    >
      <p className="flex items-start gap-2 text-sm">
        <CircleAlert className="mt-0.5 size-4 shrink-0 text-destructive" />
        {t(`chat.errors.${code}`)}
      </p>
      <div className="flex items-center gap-2">
        {needsSettings ? (
          <Button asChild size="sm" variant="outline">
            <Link to="/settings">{t("chat.goToSettings")}</Link>
          </Button>
        ) : (
          <Button size="sm" variant="outline" onClick={onRetry}>
            <RotateCcw />
            {t("chat.retry")}
          </Button>
        )}
        <details className="text-xs text-muted-foreground">
          <summary className="cursor-pointer select-none">{t("chat.details")}</summary>
          <p className="mt-1 font-mono break-all">{details}</p>
        </details>
      </div>
    </div>
  );
}
