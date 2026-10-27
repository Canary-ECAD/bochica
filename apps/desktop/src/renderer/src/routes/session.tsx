import { ArrowUp } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";

export function SessionPage() {
  const { t } = useTranslation();
  const [draft, setDraft] = useState("");

  return (
    <div className="flex flex-1 flex-col items-center justify-center px-6">
      <div className="w-full max-w-2xl">
        <h1 className="mb-6 text-center text-2xl font-medium">{t("session.greeting")}</h1>

        <form
          className="rounded-lg border bg-background p-3 shadow-sm focus-within:ring-2 focus-within:ring-ring"
          onSubmit={(event) => event.preventDefault()}
        >
          <textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder={t("session.placeholder")}
            rows={3}
            className="w-full resize-none bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">{t("session.agentNotReady")}</span>
            <Button type="submit" size="icon" disabled aria-label={t("session.send")}>
              <ArrowUp />
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
