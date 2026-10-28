import { Check, ChevronDown, ClipboardList, ShieldCheck, Zap } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import type { PermissionMode } from "@/state/permission";

const modes: ReadonlyArray<{ id: PermissionMode; icon: typeof Zap }> = [
  { id: "ask", icon: ShieldCheck },
  { id: "plan", icon: ClipboardList },
  { id: "auto", icon: Zap },
];

/** How much Bochica asks in this session: as usual, plan first, or Auto. */
export function PermissionPicker({
  mode,
  onChange,
}: {
  mode: PermissionMode;
  onChange(mode: PermissionMode): void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const Icon = modes.find((m) => m.id === mode)?.icon ?? ShieldCheck;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className={cn(
            "text-muted-foreground",
            mode === "plan" && "text-primary",
            mode === "auto" && "text-destructive hover:text-destructive",
          )}
          aria-label={t("permission.label")}
          title={t(`permission.${mode}.description`)}
        >
          <Icon />
          {t(`permission.${mode}.name`)}
          <ChevronDown />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-1" align="start">
        {modes.map(({ id, icon: ItemIcon }) => (
          <button
            key={id}
            type="button"
            onClick={() => {
              onChange(id);
              setOpen(false);
            }}
            className="flex w-full items-start gap-3 rounded-md p-2 text-left hover:bg-accent"
          >
            <ItemIcon
              className={cn(
                "mt-0.5 size-4 shrink-0 text-muted-foreground",
                id === "auto" && "text-destructive",
              )}
            />
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium">{t(`permission.${id}.name`)}</span>
              <span className="block text-xs text-muted-foreground">
                {t(`permission.${id}.description`)}
              </span>
            </span>
            {id === mode && <Check className="mt-0.5 size-4 shrink-0" />}
          </button>
        ))}
      </PopoverContent>
    </Popover>
  );
}
