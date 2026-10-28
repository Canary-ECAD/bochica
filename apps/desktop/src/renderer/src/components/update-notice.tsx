import type { UpdateStatus } from "@bochica/shared";
import { useQuery } from "@tanstack/react-query";
import type { TFunction } from "i18next";
import { Download, X } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";

export const updateStatusKey = ["update-status"] as const;

/** The updater's state, kept current by `updates.onStatus` in main.tsx. */
function useUpdateStatus(): UpdateStatus | undefined {
  return useQuery({ queryKey: updateStatusKey, queryFn: () => window.bochica.updates.status() })
    .data;
}

// Main pushes every change, so the buttons only ask.
const updateNow = () => void window.bochica.updates.install();
const later = () => void window.bochica.updates.later();
const check = () => void window.bochica.updates.check();
const retry = (status: UpdateStatus) => (status.failedDuring === "check" ? check() : updateNow());

function errorText(t: TFunction, status: UpdateStatus): string {
  const what = t(`updates.errors.${status.failedDuring ?? "download"}`);
  const next = t(status.error === "offline" ? "updates.errors.offline" : "updates.errors.keeps");
  return `${what} ${next}`;
}

function WhatsNew({ status }: { status: UpdateStatus }) {
  const { t } = useTranslation();
  if (!status.notesUrl) return null;
  return (
    <a
      href={status.notesUrl}
      target="_blank"
      rel="noreferrer"
      className="text-xs text-muted-foreground underline-offset-2 hover:underline"
    >
      {t("updates.whatsNew")}
    </a>
  );
}

/**
 * Sidebar notice for a new version: Update now or Later, then the download and the restart.
 * "Later" hides it; Settings → General still shows the update.
 */
export function UpdateNotice() {
  const { t } = useTranslation();
  const status = useUpdateStatus();
  const [dismissed, setDismissed] = useState(false);
  if (!status || status.deferred) return null;
  const failed = status.state === "error" && status.failedDuring !== "check";
  if (!["available", "downloading", "ready"].includes(status.state) && !failed) return null;
  if (failed && dismissed) return null;
  const version = status.version ?? "";

  return (
    <div className="mb-1 flex flex-col gap-2 rounded-lg border bg-card p-3 text-sm">
      <div className="flex items-start gap-2">
        <Download className="mt-0.5 size-4 shrink-0 text-primary" />
        <div className="min-w-0 flex-1">
          <p className="font-medium">{t("updates.available", { version })}</p>
          {status.state === "downloading" && (
            <p className="text-xs text-muted-foreground">
              {t("updates.downloading", { percent: status.percent ?? 0 })}
            </p>
          )}
          {status.state === "ready" && (
            <p className="text-xs text-muted-foreground">
              {t(status.waiting ? "updates.waiting" : "updates.restarting")}
            </p>
          )}
          {failed && <p className="text-xs text-muted-foreground">{errorText(t, status)}</p>}
        </div>
        {failed && (
          <button
            type="button"
            aria-label={t("updates.dismiss")}
            onClick={() => setDismissed(true)}
            className="text-muted-foreground hover:text-foreground"
          >
            <X className="size-4" />
          </button>
        )}
      </div>
      {status.state === "downloading" && (
        <div className="h-1 overflow-hidden rounded-full bg-muted">
          <div className="h-full bg-primary" style={{ width: `${status.percent ?? 0}%` }} />
        </div>
      )}
      {status.state === "available" && (
        <div className="flex items-center gap-2">
          <Button size="sm" onClick={updateNow}>
            {t("updates.updateNow")}
          </Button>
          <Button size="sm" variant="ghost" onClick={later}>
            {t("updates.later")}
          </Button>
        </div>
      )}
      {failed && (
        <Button size="sm" variant="outline" className="self-start" onClick={() => retry(status)}>
          {t("updates.tryAgain")}
        </Button>
      )}
      <WhatsNew status={status} />
    </div>
  );
}

/** The Updates row of Settings → General: version, state and what can be done now. */
export function UpdateSettings() {
  const { t } = useTranslation();
  const status = useUpdateStatus();
  if (!status) return null;
  const version = status.version ?? "";

  let line: string;
  let action: { label: string; run: () => void } | null = null;
  switch (status.state) {
    case "off":
      line = t("updates.settings.off");
      break;
    case "idle":
      line = t(status.upToDateAt ? "updates.settings.upToDate" : "updates.settings.idle");
      action = { label: t("updates.settings.check"), run: check };
      break;
    case "checking":
      line = t("updates.settings.checking");
      break;
    case "available":
      line = t("updates.available", { version });
      action = { label: t("updates.updateNow"), run: updateNow };
      break;
    case "downloading":
      line = `${t("updates.available", { version })} ${t("updates.downloading", { percent: status.percent ?? 0 })}`;
      break;
    case "ready":
      if (status.waiting) {
        line = t("updates.waiting");
      } else if (status.deferred) {
        line = t("updates.settings.deferred", { version });
        action = { label: t("updates.settings.restartNow"), run: updateNow };
      } else {
        line = t("updates.restarting");
      }
      break;
    case "error":
      line = errorText(t, status);
      action = { label: t("updates.tryAgain"), run: () => retry(status) };
      break;
  }

  return (
    <div className="flex items-center justify-between gap-4 rounded-lg border p-4">
      <div className="min-w-0">
        <p className="text-sm">{t("updates.settings.version", { version: status.current })}</p>
        <p className="text-xs text-muted-foreground">{line}</p>
        <WhatsNew status={status} />
      </div>
      {action && (
        <Button variant="outline" size="sm" className="shrink-0" onClick={action.run}>
          {action.label}
        </Button>
      )}
    </div>
  );
}
