import { ClipboardList, Play } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Markdown } from "@/components/markdown";
import { Button } from "@/components/ui/button";
import type { ToolPart } from "@/state/sessions";

/**
 * The plan the agent proposed in plan mode. While it is the latest one and the session is still
 * planning, "Go ahead" approves it; writing anything else asks for another plan.
 */
export function PlanCard({
  part,
  onApprove,
}: {
  part: ToolPart;
  onApprove?: (() => void) | undefined;
}) {
  const { t } = useTranslation();
  const plan = (part.input as { plan?: unknown } | null)?.plan;
  if (typeof plan !== "string") return null;

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-primary/40 bg-primary/5 p-3">
      <p className="flex items-center gap-2 text-sm font-medium">
        <ClipboardList className="size-4 text-primary" />
        {t("plan.title")}
      </p>
      <Markdown>{plan}</Markdown>
      {onApprove && (
        <div className="flex flex-wrap items-center gap-3">
          <Button size="sm" onClick={onApprove}>
            <Play />
            {t("plan.goAhead")}
          </Button>
          <span className="text-xs text-muted-foreground">{t("plan.hint")}</span>
        </div>
      )}
    </div>
  );
}
