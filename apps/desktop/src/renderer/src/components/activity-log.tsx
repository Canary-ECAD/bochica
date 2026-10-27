import { Ban, Check, ChevronRight, CircleAlert, LoaderCircle } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { describeCall, describeGroup } from "@/lib/activity";
import { cn } from "@/lib/utils";
import type { ToolPart } from "@/state/sessions";

// Consecutive tool calls collapse into one line ("Consulted the EPLAN 2027 docs 3 times");
// expanding shows one row per call, and each row expands to its input and output.

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
  }
}

/** The group's icon: running beats failed beats denied beats done. */
function groupStatus(parts: ToolPart[]): ToolPart["status"] {
  for (const status of ["running", "error", "denied"] as const) {
    if (parts.some((p) => p.status === status)) return status;
  }
  return "ok";
}

export function ActivityGroup({ parts }: { parts: ToolPart[] }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const summary = describeGroup(
    t,
    parts.map((p) => p.server),
  );

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
        <ChevronRight className={cn("size-3.5 transition-transform", open && "rotate-90")} />
      </button>
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
        <ChevronRight
          className={cn("size-3.5 shrink-0 transition-transform", open && "rotate-90")}
        />
      </button>
      {open && (
        <div className="my-1 flex flex-col gap-2 rounded-lg border bg-code p-3 text-xs">
          <div>
            <div className="mb-1 font-medium text-muted-foreground">{t("activity.input")}</div>
            <pre className="font-mono break-all whitespace-pre-wrap">
              {JSON.stringify(part.input, null, 2)}
            </pre>
          </div>
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
