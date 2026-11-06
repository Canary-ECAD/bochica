import type { PartsReport, PartsSeverity } from "@bochica/shared";
import { ChevronRight, FileSpreadsheet, Stethoscope } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const severityStyle: Record<PartsSeverity, string> = {
  serious: "bg-destructive/10 text-destructive",
  medium: "bg-warning/15 text-warning",
  minor: "bg-muted text-muted-foreground",
};

/**
 * The parts database report: rules grouped by severity with their counts, a few part numbers
 * under each, and the CSV with every finding. Rules that found nothing are folded into one line.
 */
export function PartsReportCard({ report }: { report: PartsReport }) {
  const { t, i18n } = useTranslation();
  const number = (n: number) => n.toLocaleString(i18n.language);
  const failing = report.rules.filter((rule) => rule.count > 0);
  const passing = report.rules.filter((rule) => rule.count === 0);

  return (
    <div className="flex flex-col gap-3 rounded-lg border p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="flex items-center gap-2 text-sm font-medium">
          <Stethoscope className="size-4 text-primary" />
          {t("partsReport.title")}
        </p>
        <span className="text-xs text-muted-foreground">
          {t("partsReport.total", { count: report.total, total: number(report.total) })}
        </span>
      </div>
      {failing.length === 0 ? (
        <p className="text-sm">{t("partsReport.allGood")}</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {failing.map((rule) => (
            <li key={rule.id}>
              <details className="group">
                <summary className="flex cursor-pointer list-none items-center gap-2 rounded-md px-1 py-1 text-sm select-none hover:bg-muted/60">
                  <ChevronRight className="size-3.5 shrink-0 text-muted-foreground transition-transform group-open:rotate-90" />
                  <span
                    className={cn(
                      "rounded px-1.5 py-0.5 text-[11px] font-medium",
                      severityStyle[rule.severity],
                    )}
                  >
                    {t(`partsReport.severity.${rule.severity}`)}
                  </span>
                  <span className="min-w-0 flex-1 truncate">
                    {t(`partsReport.rule.${rule.id}`, { defaultValue: rule.id })}
                  </span>
                  <span className="font-mono text-xs tabular-nums">{number(rule.count)}</span>
                </summary>
                <p className="mt-1 pl-8 font-mono text-xs break-all text-muted-foreground">
                  {rule.examples.join(" · ")}
                  {rule.count > rule.examples.length &&
                    ` ${t("partsReport.more", { count: rule.count - rule.examples.length })}`}
                </p>
              </details>
            </li>
          ))}
        </ul>
      )}
      {passing.length > 0 && failing.length > 0 && (
        <p className="text-xs text-muted-foreground">
          {t("partsReport.passing", {
            rules: passing
              .map((r) => t(`partsReport.rule.${r.id}`, { defaultValue: r.id }))
              .join(", "),
          })}
        </p>
      )}
      <div>
        <Button
          size="sm"
          variant="outline"
          onClick={() => void window.bochica.files.openReport(report.csv)}
        >
          <FileSpreadsheet />
          {t("partsReport.openCsv")}
        </Button>
      </div>
    </div>
  );
}
