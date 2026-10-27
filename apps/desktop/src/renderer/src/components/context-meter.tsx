import type { ContextUsage } from "@bochica/shared";
import { useTranslation } from "react-i18next";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

/** Where Bochica summarises the older conversation by itself; matches COMPACT_AT in agent. */
const COMPACT_AT = 0.75;

/** How full the model's context was after the last answer, as a small ring. */
export function ContextMeter({ usage }: { usage: ContextUsage }) {
  const { t, i18n } = useTranslation();
  const share = Math.min(1, usage.used / usage.window);
  const percent = Math.round(share * 100);
  const radius = 7;
  const circumference = 2 * Math.PI * radius;
  const number = (n: number) => n.toLocaleString(i18n.language);
  const rows = [
    ["instructions", usage.instructions],
    ["tools", usage.tools],
    ["conversation", usage.conversation],
    ["free", Math.max(0, usage.window - usage.used)],
  ] as const;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={t("context.label", { percent })}
          className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-accent"
        >
          <svg viewBox="0 0 18 18" className="size-4 -rotate-90">
            <circle
              cx="9"
              cy="9"
              r={radius}
              fill="none"
              strokeWidth="2.5"
              className="stroke-muted"
            />
            <circle
              cx="9"
              cy="9"
              r={radius}
              fill="none"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeDasharray={circumference}
              strokeDashoffset={circumference * (1 - share)}
              className={cn(share >= COMPACT_AT ? "stroke-destructive" : "stroke-primary")}
            />
          </svg>
          {percent}%
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-72 text-sm" align="start">
        <p className="font-medium">{t("context.title")}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {t("context.used", { used: number(usage.used), window: number(usage.window), percent })}
        </p>
        <dl className="mt-3 flex flex-col gap-1">
          {rows.map(([key, value]) => (
            <div key={key} className="flex justify-between gap-4">
              <dt className="text-muted-foreground">{t(`context.parts.${key}`)}</dt>
              <dd className="tabular-nums">{number(value)}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-3 text-xs text-muted-foreground">
          {t("context.note", { percent: COMPACT_AT * 100 })}
        </p>
      </PopoverContent>
    </Popover>
  );
}
