import type { ChatMode } from "@bochica/shared";
import { Check, ChevronDown, MessageCircleQuestion, PenTool, Wrench } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useMode } from "@/state/mode";

const modes: ReadonlyArray<{ id: ChatMode; icon: typeof Wrench }> = [
  { id: "consult", icon: MessageCircleQuestion },
  { id: "tasks", icon: Wrench },
  { id: "draw", icon: PenTool },
];

/** What the agent may do: answer and help with scripts, work in EPLAN, or draw. */
export function ModePicker() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const { mode, setMode } = useMode();
  const current = modes.find((m) => m.id === mode) ?? modes[0];
  const Icon = current?.icon ?? MessageCircleQuestion;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="text-muted-foreground"
          aria-label={t("modes.label")}
        >
          <Icon />
          {t(`modes.${mode}.name`)}
          <ChevronDown />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-1" align="start">
        {modes.map(({ id, icon: ItemIcon }) => (
          <button
            key={id}
            type="button"
            onClick={() => {
              setMode(id);
              setOpen(false);
            }}
            className="flex w-full items-start gap-3 rounded-md p-2 text-left hover:bg-accent"
          >
            <ItemIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-2 text-sm font-medium">
                {t(`modes.${id}.name`)}
                {id === "draw" && <Badge variant="secondary">{t("modes.experimental")}</Badge>}
              </span>
              <span className="block text-xs text-muted-foreground">
                {t(`modes.${id}.description`)}
              </span>
            </span>
            {id === mode && <Check className="mt-0.5 size-4 shrink-0" />}
          </button>
        ))}
      </PopoverContent>
    </Popover>
  );
}
