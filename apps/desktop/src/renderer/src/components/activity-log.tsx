import type { FileDiff } from "@bochica/shared";
import { Ban, Check, ChevronRight, CircleAlert, LoaderCircle, ShieldX } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { describeCall, describeGroup } from "@/lib/activity";
import { cn } from "@/lib/utils";
import type { ToolPart } from "@/state/sessions";

// Consecutive tool calls collapse into one line ("Read 2 files, edited a file  +12 −3");
// expanding shows one row per call, and each row expands to its input and output, or to the
// diff for file changes.

function StatusIcon({ status }: { status: ToolPart["status"] }) {
  switch (status) {
    case "running":
      return <LoaderCircle className="size-3.5 shrink-0 animate-spin" />;
    case "ok":
      return <Check className="size-3.5 shrink-0 text-success" />;
    case "error":
      return <CircleAlert className="size-3.5 shrink-0 text-destructive" />;
    case "denied":
      return <Ban className="size-3.5 shrink-0 text-muted-foreground" />;
    case "blocked":
      return <ShieldX className="size-3.5 shrink-0 text-destructive" />;
  }
}

/** The group's icon: running beats failed beats blocked beats denied beats done. */
function groupStatus(parts: ToolPart[]): ToolPart["status"] {
  for (const status of ["running", "error", "blocked", "denied"] as const) {
    if (parts.some((p) => p.status === status)) return status;
  }
  return "ok";
}

/** `+12 −3`, in the diff colors; nothing when there are no changes. */
function DiffBadge({ added, removed }: { added: number; removed: number }) {
  if (added === 0 && removed === 0) return null;
  return (
    <span className="shrink-0 font-mono text-xs">
      <span className="text-success">+{added}</span>{" "}
      <span className="text-destructive">−{removed}</span>
    </span>
  );
}

function totals(parts: ToolPart[]): { added: number; removed: number } {
  return parts.reduce(
    (sum, p) => ({
      added: sum.added + (p.diff?.added ?? 0),
      removed: sum.removed + (p.diff?.removed ?? 0),
    }),
    { added: 0, removed: 0 },
  );
}

export function ActivityGroup({ parts }: { parts: ToolPart[] }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const summary = describeGroup(t, parts);

  return (
    <div className="text-sm">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="flex items-center gap-2 rounded-md py-0.5 text-muted-foreground hover:text-foreground"
      >
        <StatusIcon status={groupStatus(parts)} />
        <span>{summary}</span>
        <DiffBadge {...totals(parts)} />
        <ChevronRight className={cn("size-3.5 transition-transform", open && "rotate-90")} />
      </button>
      {!open &&
        parts.map(
          (part) =>
            part.blocked && (
              <p key={part.callId} className="ml-5.5 text-xs text-destructive">
                {t("activity.blocked", { reason: t(`blocked.${part.blocked}`) })}
              </p>
            ),
        )}
      {open && (
        <ul className="mt-1 ml-[7px] flex flex-col gap-0.5 border-l pl-4">
          {parts.map((part) => (
            <ToolRow key={part.callId} part={part} />
          ))}
        </ul>
      )}
    </div>
  );
}

function ToolRow({ part }: { part: ToolPart }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const label = describeCall(t, part.server, part.tool, part.input);
  const blocked = part.blocked
    ? t("activity.blocked", { reason: t(`blocked.${part.blocked}`) })
    : null;

  return (
    <li>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        title={label}
        className="flex w-full min-w-0 items-center gap-2 rounded-md py-0.5 text-left text-muted-foreground hover:text-foreground"
      >
        <StatusIcon status={part.status} />
        <span className="truncate">{label}</span>
        {part.diff && <DiffBadge added={part.diff.added} removed={part.diff.removed} />}
        <ChevronRight
          className={cn("size-3.5 shrink-0 transition-transform", open && "rotate-90")}
        />
      </button>
      {blocked && <p className="ml-5.5 text-xs text-destructive">{blocked}</p>}
      {open && (
        <div className="my-1 flex flex-col gap-2 rounded-lg border bg-code p-3 text-xs">
          {part.diff ? (
            <Patch diff={part.diff} />
          ) : (
            <div>
              <div className="mb-1 font-medium text-muted-foreground">{t("activity.input")}</div>
              <pre className="font-mono break-all whitespace-pre-wrap">
                {JSON.stringify(part.input, null, 2)}
              </pre>
            </div>
          )}
          {part.output !== undefined && (
            <div>
              <div className="mb-1 font-medium text-muted-foreground">{t("activity.output")}</div>
              <pre className="max-h-64 overflow-y-auto font-mono break-all whitespace-pre-wrap">
                {part.output}
              </pre>
            </div>
          )}
        </div>
      )}
    </li>
  );
}

/** A unified patch with added lines in green and removed lines in red. */
function Patch({ diff }: { diff: FileDiff }) {
  const { t } = useTranslation();
  return (
    <div>
      <div className="mb-1 font-medium text-muted-foreground">
        {t("activity.changes")} · {diff.path}
      </div>
      <pre className="max-h-80 overflow-auto font-mono">
        {diff.patch.split("\n").map((line, i) => (
          <div
            // Lines of a fixed patch never reorder.
            // oxlint-disable-next-line react/no-array-index-key
            key={i}
            className={cn(
              "whitespace-pre-wrap break-all",
              line.startsWith("+") && "bg-success/10 text-success",
              line.startsWith("-") && "bg-destructive/10 text-destructive",
              line.startsWith("@@") && "text-muted-foreground",
            )}
          >
            {line || " "}
          </div>
        ))}
      </pre>
    </div>
  );
}
