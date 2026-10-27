import { type ApprovalRequest, type Confirmation, confirmationMatches } from "@bochica/shared";
import { ShieldAlert, ShieldQuestion } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { describeCall } from "@/lib/activity";
import { cn } from "@/lib/utils";
import { answerApproval } from "@/state/sessions";

/**
 * Asks before a tool that changes something runs (guardrails layer 5). The user approves the
 * outcome in plain language; the raw call is under "Details". Destructive calls (layer 6) also
 * need the user to type what the card asks for; main checks that text again.
 */
export function ApprovalCard({ request }: { request: ApprovalRequest }) {
  const { t } = useTranslation();
  const [typed, setTyped] = useState("");
  const answer = (decision: "once" | "session" | "deny") => () =>
    answerApproval(request.requestId, decision, request.confirm ? typed : undefined);
  const destructive = request.confirm !== undefined;
  const confirmed = request.confirm ? confirmationMatches(request.confirm, typed) : true;

  return (
    <div
      className={cn(
        "flex flex-col gap-3 rounded-lg border p-3",
        destructive ? "border-destructive/50 bg-destructive/5" : "border-primary/40 bg-primary/5",
      )}
      role="alertdialog"
    >
      <div className="flex items-start gap-2">
        {destructive ? (
          <ShieldAlert className="mt-0.5 size-4 shrink-0 text-destructive" />
        ) : (
          <ShieldQuestion className="mt-0.5 size-4 shrink-0 text-primary" />
        )}
        <div className="min-w-0">
          <p className="text-sm font-medium">
            {t(destructive ? "approval.destructiveTitle" : "approval.title")}
          </p>
          <p className="text-sm">
            {describeCall(t, request.server, request.tool, request.input, "request")}
          </p>
          {destructive ? (
            <p className="mt-1 text-xs text-muted-foreground">{t("approval.cannotUndo")}</p>
          ) : (
            !request.allowSession && (
              <p className="mt-1 text-xs text-muted-foreground">{t("approval.alwaysAsks")}</p>
            )
          )}
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
      {request.confirm && (
        <ConfirmField
          confirm={request.confirm}
          value={typed}
          onChange={setTyped}
          onSubmit={() => {
            if (confirmed) answer("once")();
          }}
        />
      )}
      <div className="flex flex-wrap items-center gap-2">
        {destructive ? (
          <Button
            size="sm"
            className="bg-destructive text-white hover:bg-destructive/90"
            disabled={!confirmed}
            onClick={answer("once")}
          >
            {t("approval.confirmDestructive")}
          </Button>
        ) : (
          <Button size="sm" onClick={answer("once")} autoFocus>
            {t("approval.once")}
          </Button>
        )}
        {request.allowSession && !destructive && (
          <Button size="sm" variant="outline" onClick={answer("session")}>
            {t("approval.session")}
          </Button>
        )}
        <Button size="sm" variant={destructive ? "outline" : "ghost"} onClick={answer("deny")}>
          {t("approval.deny")}
        </Button>
      </div>
    </div>
  );
}

function ConfirmField({
  confirm,
  value,
  onChange,
  onSubmit,
}: {
  confirm: Confirmation;
  value: string;
  onChange(value: string): void;
  onSubmit(): void;
}) {
  const { t } = useTranslation();
  const expected = confirm.type === "name" ? confirm.value : t("approval.confirmWord");
  return (
    <label className="flex flex-col gap-1.5 text-sm">
      <span>
        {t("approval.typeToConfirm")} <strong className="font-mono">{expected}</strong>
      </span>
      <input
        autoFocus
        value={value}
        spellCheck={false}
        autoComplete="off"
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") onSubmit();
        }}
        className="h-9 rounded-md border bg-background px-3 font-mono text-sm outline-none focus:ring-2 focus:ring-destructive/50"
      />
    </label>
  );
}
