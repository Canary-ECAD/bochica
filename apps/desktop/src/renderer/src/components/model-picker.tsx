import { Check, ChevronDown } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { ModelChoiceState } from "@/state/model-choice";

export function ModelPicker({ state }: { state: ModelChoiceState }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const { groups, choice, setChoice } = state;

  const selected = groups
    .find((g) => g.provider.id === choice?.provider)
    ?.models.find((m) => m.id === choice?.model);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" className="max-w-64 text-muted-foreground">
          <span className="truncate">{selected?.label ?? t("chat.chooseModel")}</span>
          <ChevronDown />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-0" align="start">
        <Command>
          <CommandInput placeholder={t("chat.searchModels")} />
          <CommandList>
            <CommandEmpty>{t("chat.noModelsFound")}</CommandEmpty>
            {groups.map((group) => (
              <CommandGroup key={group.provider.id} heading={group.provider.label}>
                {group.models.map((model) => {
                  const active =
                    choice?.provider === group.provider.id && choice.model === model.id;
                  return (
                    <CommandItem
                      key={model.id}
                      value={`${group.provider.label} ${model.label} ${model.id}`}
                      onSelect={() => {
                        setChoice({ provider: group.provider.id, model: model.id });
                        setOpen(false);
                      }}
                    >
                      <span className="truncate">{model.label}</span>
                      {active && <Check className="ml-auto" />}
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
