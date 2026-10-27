import type { SkillFinding, SkillInfo, SkillInstallReport } from "@bochica/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FolderPlus, Trash2, TriangleAlert } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";

export const skillsKey = ["skills"] as const;

/** Every skill: the built-in scripting guides and the ones the user added. */
export function SkillsSettings() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const skills = useQuery({ queryKey: skillsKey, queryFn: () => window.bochica.skills.list() });
  const setList = (list: SkillInfo[]) => queryClient.setQueryData(skillsKey, list);
  const toggle = useMutation({
    mutationFn: (request: { id: string; enabled: boolean }) =>
      window.bochica.skills.setEnabled(request),
    onSuccess: setList,
  });
  const remove = useMutation({
    mutationFn: (id: string) => window.bochica.skills.remove(id),
    onSuccess: setList,
  });
  const install = useMutation({
    mutationFn: () => window.bochica.skills.install(),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: skillsKey }),
  });

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col divide-y rounded-lg border">
        {(skills.data ?? []).map((skill) => (
          <div key={skill.id} className="flex items-start justify-between gap-4 p-4">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-sm font-medium">{skill.name}</span>
                <Badge variant={skill.source === "builtin" ? "secondary" : "outline"}>
                  {t(`skills.source.${skill.source}`)}
                </Badge>
                {skill.status !== "ok" && (
                  <Badge variant="destructive">{t(`skills.status.${skill.status}`)}</Badge>
                )}
              </div>
              {skill.description && (
                <p className="mt-0.5 line-clamp-2 text-sm text-muted-foreground">
                  {skill.description}
                </p>
              )}
              {skill.problem && (
                <p className="mt-1 text-xs text-destructive">
                  {t(`skills.problem.${skill.problem}`)}
                </p>
              )}
              {skill.findings && <Findings findings={skill.findings} />}
            </div>
            {skill.source === "user" && (
              <div className="flex shrink-0 items-center gap-1">
                <Switch
                  checked={skill.enabled && skill.status === "ok"}
                  disabled={skill.status !== "ok" || toggle.isPending}
                  onCheckedChange={(enabled) => toggle.mutate({ id: skill.id, enabled })}
                  aria-label={skill.name}
                />
                <Button
                  variant="ghost"
                  size="icon"
                  disabled={remove.isPending}
                  onClick={() => remove.mutate(skill.id)}
                  aria-label={t("skills.remove", { name: skill.name })}
                  title={t("skills.remove", { name: skill.name })}
                >
                  <Trash2 />
                </Button>
              </div>
            )}
          </div>
        ))}
        {skills.data?.length === 0 && (
          <p className="p-4 text-sm text-muted-foreground">{t("skills.empty")}</p>
        )}
      </div>
      <div>
        <Button variant="outline" disabled={install.isPending} onClick={() => install.mutate()}>
          <FolderPlus />
          {t("skills.add")}
        </Button>
      </div>
      {install.data && <InstallResult report={install.data} />}
    </div>
  );
}

function Findings({ findings }: { findings: SkillFinding[] }) {
  const { t } = useTranslation();
  return (
    <ul className="mt-1 flex flex-col gap-0.5 text-xs text-destructive">
      {findings.map((f) => (
        <li key={`${f.file}:${f.line}:${f.kind}`}>
          {t("skills.finding", {
            reason: t(`skills.findings.${f.kind}`),
            file: f.file,
            line: f.line,
          })}
        </li>
      ))}
    </ul>
  );
}

function InstallResult({ report }: { report: SkillInstallReport }) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-2 rounded-lg border p-3 text-sm">
      {report.installed.length > 0 && (
        <p>
          {t("skills.added", {
            count: report.installed.length,
            names: report.installed.join(", "),
          })}
        </p>
      )}
      {report.refused.map((refused) => (
        <div key={refused.folder} className="flex items-start gap-2">
          <TriangleAlert className="mt-0.5 size-4 shrink-0 text-destructive" />
          <div className="min-w-0">
            <p>
              {t("skills.refused", {
                folder: refused.folder,
                reason: t(`skills.problem.${refused.problem}`),
              })}
            </p>
            {refused.findings && <Findings findings={refused.findings} />}
          </div>
        </div>
      ))}
    </div>
  );
}
