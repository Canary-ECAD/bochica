import type { EplanStatus } from "@bochica/shared";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export const eplanStatusKey = ["eplan-status"] as const;

const dotColor: Record<EplanStatus["state"], string> = {
  connected: "bg-success",
  busy: "bg-primary",
  starting: "bg-muted-foreground animate-pulse",
  not_configured: "bg-muted-foreground",
  not_installed: "bg-muted-foreground",
  closed: "bg-destructive",
  unreachable: "bg-destructive",
  error: "bg-destructive",
};

/** The EPLAN connection, kept current by `eplan.onStatus` in main.tsx. */
export function useEplanStatus(): EplanStatus | undefined {
  return useQuery({ queryKey: eplanStatusKey, queryFn: () => window.bochica.eplan.status() }).data;
}

export function EplanDot({ status }: { status: EplanStatus | undefined }) {
  return (
    <span className={cn("size-2 shrink-0 rounded-full", dotColor[status?.state ?? "starting"])} />
  );
}

/** What the status means and what to do about it. */
export function EplanStatusDetails({ status }: { status: EplanStatus | undefined }) {
  const { t } = useTranslation();
  const state = status?.state ?? "starting";
  return (
    <>
      <p className="mt-1 text-muted-foreground">{t(`eplan.help.${state}`)}</p>
      {state === "unreachable" && (
        <ol className="mt-2 list-decimal space-y-1 pl-5 text-muted-foreground">
          <li>{t("eplan.remoteSteps.open")}</li>
          <li>{t("eplan.remoteSteps.navigate")}</li>
          <li>{t("eplan.remoteSteps.enable")}</li>
          <li>{t("eplan.remoteSteps.wait")}</li>
        </ol>
      )}
      {status?.detail && (
        <p className="mt-2 font-mono text-xs break-all text-muted-foreground">{status.detail}</p>
      )}
    </>
  );
}

/** Sidebar line that always says whether Bochica can reach EPLAN, with what to do if not. */
export function EplanIndicator() {
  const { t } = useTranslation();
  const status = useEplanStatus();
  const label = t(`eplan.label.${status?.state ?? "starting"}`, { version: status?.version ?? "" });

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground"
        >
          <EplanDot status={status} />
          <span className="truncate">{label}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent side="right" align="end" className="w-80 text-sm">
        <p className="font-medium">{label}</p>
        <EplanStatusDetails status={status} />
      </PopoverContent>
    </Popover>
  );
}
