import type { AlwaysAllowRule, Permissions } from "@bochica/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";

const permissionsKey = ["permissions"] as const;

/** Smart approvals, "Never allow" patterns and the "Always allow" list. */
export function PermissionsSettings() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const permissions = useQuery({
    queryKey: permissionsKey,
    queryFn: () => window.bochica.permissions.get(),
  });
  const save = useMutation({
    mutationFn: (next: Permissions) => window.bochica.permissions.set(next),
    onSuccess: (saved) => queryClient.setQueryData(permissionsKey, saved),
  });
  const [pattern, setPattern] = useState("");
  const data = permissions.data;
  if (!data) return null;

  const update = (change: Partial<Permissions>) => save.mutate({ ...data, ...change });
  const addRule = () => {
    const rule = pattern.trim();
    if (!rule) return;
    update({ denyRules: [...data.denyRules, rule] });
    setPattern("");
  };

  return (
    <div className="flex flex-col gap-4">
      <label className="flex items-start justify-between gap-4 rounded-lg border p-4">
        <span className="min-w-0">
          <span className="block text-sm font-medium">{t("permissions.smart")}</span>
          <span className="block text-sm text-muted-foreground">
            {t("permissions.smartDescription")}
          </span>
        </span>
        <Switch
          checked={data.smart}
          disabled={save.isPending}
          onCheckedChange={(smart) => update({ smart })}
          aria-label={t("permissions.smart")}
        />
      </label>

      <div className="rounded-lg border p-4">
        <p className="text-sm font-medium">{t("permissions.deny")}</p>
        <p className="mb-3 text-sm text-muted-foreground">{t("permissions.denyDescription")}</p>
        <ul className="mb-3 flex flex-col gap-1">
          {data.denyRules.map((rule) => (
            <li key={rule} className="flex items-center justify-between gap-2">
              <code className="truncate font-mono text-sm">{rule}</code>
              <RemoveButton
                label={t("permissions.remove")}
                disabled={save.isPending}
                onClick={() => update({ denyRules: data.denyRules.filter((r) => r !== rule) })}
              />
            </li>
          ))}
          {data.denyRules.length === 0 && (
            <li className="text-sm text-muted-foreground">{t("permissions.denyEmpty")}</li>
          )}
        </ul>
        <form
          className="flex gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            addRule();
          }}
        >
          <Input
            value={pattern}
            maxLength={200}
            spellCheck={false}
            onChange={(event) => setPattern(event.target.value)}
            placeholder={t("permissions.denyPlaceholder")}
            className="font-mono"
          />
          <Button type="submit" variant="outline" disabled={!pattern.trim() || save.isPending}>
            <Plus />
            {t("permissions.add")}
          </Button>
        </form>
      </div>

      <div className="rounded-lg border p-4">
        <p className="text-sm font-medium">{t("permissions.always")}</p>
        <p className="mb-3 text-sm text-muted-foreground">{t("permissions.alwaysDescription")}</p>
        <ul className="flex flex-col gap-1">
          {data.alwaysAllow.map((rule) => (
            <li key={ruleKey(rule)} className="flex items-center justify-between gap-2">
              {rule.kind === "command" ? (
                <code className="truncate font-mono text-sm" title={rule.command}>
                  {rule.command}
                </code>
              ) : (
                <span className="truncate text-sm">
                  {t("permissions.tool", { tool: rule.tool, server: rule.server })}
                </span>
              )}
              <RemoveButton
                label={t("permissions.remove")}
                disabled={save.isPending}
                onClick={() =>
                  update({
                    alwaysAllow: data.alwaysAllow.filter((r) => ruleKey(r) !== ruleKey(rule)),
                  })
                }
              />
            </li>
          ))}
          {data.alwaysAllow.length === 0 && (
            <li className="text-sm text-muted-foreground">{t("permissions.alwaysEmpty")}</li>
          )}
        </ul>
      </div>
    </div>
  );
}

function ruleKey(rule: AlwaysAllowRule): string {
  return rule.kind === "command" ? `c:${rule.command}` : `t:${rule.server}:${rule.tool}`;
}

function RemoveButton({
  label,
  disabled,
  onClick,
}: {
  label: string;
  disabled: boolean;
  onClick(): void;
}) {
  return (
    <Button
      variant="ghost"
      size="icon"
      className="size-7 shrink-0"
      disabled={disabled}
      onClick={onClick}
      aria-label={label}
      title={label}
    >
      <Trash2 />
    </Button>
  );
}
