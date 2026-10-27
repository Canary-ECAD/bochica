import type { ApprovalRequest } from "@bochica/shared";
import { ShieldQuestion } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { describeCall } from "@/lib/activity";
import { answerApproval } from "@/state/sessions";

/**
 * Asks before a tool that changes something runs (guardrails layer 5). The user approves the
 * outcome in plain language; the raw call is under "Details".
 */
export function ApprovalCard({ request }: { request: ApprovalRequest }) {
  const { t } = useTranslation();
  const answer = (decision: "once" | "session" | "deny") => () =>
    answerApproval(request.requestId, decision);

  return (
    <div
      className="flex flex-col gap-3 rounded-lg border border-primary/40 bg-primary/5 p-3"
      role="alertdialog"
    >
      <div className="flex items-start gap-2">
        <ShieldQuestion className="mt-0.5 size-4 shrink-0 text-primary" />
        <div className="min-w-0">
          <p className="text-sm font-medium">{t("approval.title")}</p>
          <p className="text-sm">{describeCall(t, request.server, request.tool, request.input)}</p>
        </div>
      </div>
      <details className="text-xs text-muted-foreground">
        <summary className="cursor-pointer select-none">{t("chat.details")}</summary>
        <pre className="mt-1 font-mono break-all whitespace-pre-wrap">
          {request.server} · {request.tool}
          {"\n"}
          {JSON.stringify(request.input, null, 2)}
        </pre>
      </details>
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={answer("once")} autoFocus>
          {t("approval.once")}
        </Button>
        <Button size="sm" variant="outline" onClick={answer("session")}>
          {t("approval.session")}
        </Button>
        <Button size="sm" variant="ghost" onClick={answer("deny")}>
          {t("approval.deny")}
        </Button>
      </div>
    </div>
  );
}
