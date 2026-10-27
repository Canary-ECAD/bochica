import { Link } from "@tanstack/react-router";
import { ArrowUp, LoaderCircle, Square } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ModelPicker } from "@/components/model-picker";
import { Button } from "@/components/ui/button";
import { useModelChoice } from "@/state/model-choice";
import type { ModelChoice } from "@/state/sessions";

interface ComposerProps {
  onSend(text: string, choice: ModelChoice): void;
  /** Present while a turn is streaming: the send button becomes a stop button. */
  onStop?: (() => void) | undefined;
  autoFocus?: boolean;
}

export function Composer({ onSend, onStop, autoFocus = false }: ComposerProps) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState("");
  const models = useModelChoice();
  const { choice } = models;

  const canSend = draft.trim().length > 0 && choice !== null && !onStop;
  const submit = (): void => {
    if (!canSend) return;
    onSend(draft.trim(), choice);
    setDraft("");
  };

  return (
    <form
      className="rounded-xl border bg-card p-3 shadow-sm focus-within:ring-2 focus-within:ring-ring"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      {/* field-sizing grows the box with the text; max-h then makes it scroll. */}
      <textarea
        value={draft}
        autoFocus={autoFocus}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault();
            submit();
          }
        }}
        placeholder={t("session.placeholder")}
        className="field-sizing-content max-h-60 min-h-12 w-full resize-none bg-transparent px-1 text-sm leading-6 outline-none placeholder:text-muted-foreground"
      />
      <div className="mt-1 flex items-center justify-between gap-2">
        {models.groups.length > 0 ? (
          <ModelPicker state={models} />
        ) : models.loading ? (
          <span className="flex items-center gap-2 px-2 text-xs text-muted-foreground">
            <LoaderCircle className="size-3 animate-spin" />
            {t("chat.loadingModels")}
          </span>
        ) : (
          <Link to="/settings" className="px-2 text-xs text-primary hover:underline">
            {t("chat.addProvider")}
          </Link>
        )}
        {onStop ? (
          <Button type="button" size="icon" onClick={onStop} aria-label={t("chat.stop")}>
            <Square className="fill-current" />
          </Button>
        ) : (
          <Button type="submit" size="icon" disabled={!canSend} aria-label={t("session.send")}>
            <ArrowUp />
          </Button>
        )}
      </div>
    </form>
  );
}
