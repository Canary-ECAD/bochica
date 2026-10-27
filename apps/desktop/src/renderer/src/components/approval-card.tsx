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
 * outcome in plain language; the raw call is under "Details". Risky calls list why they ask
 * every time. Destructive calls (layer 6) also need the user to type what the card asks for;
 * main checks that text again.
 */
export function ApprovalCard({ request }: { request: ApprovalRequest }) {
  const { t } = useTranslation();
  const [typed, setTyped] = useState("");
  const answer = (decision: "once" | "session" | "deny") => () =>
    answerApproval(request.requestId, decision, request.confirm ? typed : undefined);
  const destructive = request.confirm !== undefined;
  const risks = request.risks ?? [];
  const confirmed = request.confirm ? confirmationMatches(request.confirm, typed) : true;

  return (
    <div
      className={cn(
        "flex flex-col gap-3 rounded-lg border p-3",
        destructive || risks.length > 0
          ? "border-destructive/50 bg-destructive/5"
          : "border-primary/40 bg-primary/5",
      )}
      role="alertdialog"
    >
      <div className="flex items-start gap-2">
        {destructive || risks.length > 0 ? (
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
            !request.allowSession &&
            risks.length === 0 && (
              <p className="mt-1 text-xs text-muted-foreground">{t("approval.alwaysAsks")}</p>
            )
          )}
        </div>
      </div>
      {risks.length > 0 && (
        <div className="text-sm">
          <p className="text-xs font-medium text-muted-foreground">{t("approval.risksTitle")}</p>
          <ul className="mt-1 list-disc pl-5">
            {risks.map((risk) => (
              <li key={risk}>{t(`approval.risk.${risk}`, { defaultValue: risk })}</li>
            ))}
          </ul>
        </div>
      )}
      <CallPreview request={request} />
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

function field(input: unknown, name: string): string {
  if (typeof input !== "object" || input === null) return "";
  const value = (input as Record<string, unknown>)[name];
  return typeof value === "string" ? value : "";
}

function changedLines(text: string, sign: "-" | "+") {
  return text.split(/\r?\n/).map((line, i) => (
    <div
      // Lines of the request never reorder.
      // oxlint-disable-next-line react/no-array-index-key
      key={`${sign}${i}`}
      className={sign === "+" ? "bg-success/10 text-success" : "bg-destructive/10 text-destructive"}
    >
      {sign}
      {line}
    </div>
  ));
}

/**
 * What exactly will happen, for the built-in tools: the command to run, or the text a file
 * write puts in. Shown open, not under "Details", because it is what the user approves.
 */
function CallPreview({ request }: { request: ApprovalRequest }) {
  const { t } = useTranslation();
  if (request.server !== "bochica") return null;
  const block = "max-h-48 overflow-auto rounded-md border bg-code p-2 font-mono text-xs";
  if (request.tool === "powershell") {
    return (
      <div>
        <p className="mb-1 text-xs text-muted-foreground">{t("approval.command")}</p>
        <pre className={cn(block, "break-all whitespace-pre-wrap")}>
          {field(request.input, "command")}
        </pre>
      </div>
    );
  }
  if (request.tool === "edit_file") {
    return (
      <pre className={cn(block, "whitespace-pre-wrap break-all")}>
        {changedLines(field(request.input, "old_text"), "-")}
        {changedLines(field(request.input, "new_text"), "+")}
      </pre>
    );
  }
  if (request.tool === "write_file") {
    return (
      <div>
        <p className="mb-1 text-xs text-muted-foreground">{t("approval.newContent")}</p>
        <pre className={cn(block, "whitespace-pre-wrap break-all")}>
          {field(request.input, "content")}
        </pre>
      </div>
    );
  }
  return null;
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
