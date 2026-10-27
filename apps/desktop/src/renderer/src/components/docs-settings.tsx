import type { McpServerInfo } from "@bochica/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";

export const mcpKey = ["mcp"] as const;

/** The EPLAN documentation sources (remote MCP servers) and whether each is on. */
export function DocsSettings() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const servers = useQuery({ queryKey: mcpKey, queryFn: () => window.bochica.mcp.list() });
  const toggle = useMutation({
    mutationFn: (request: { id: string; enabled: boolean }) =>
      window.bochica.mcp.setEnabled(request),
    onSuccess: (list) => queryClient.setQueryData(mcpKey, list),
  });

  return (
    <div className="flex flex-col divide-y rounded-lg border">
      {(servers.data ?? [])
        .filter((server) => server.url)
        .map((server) => (
          <div key={server.id} className="flex items-start justify-between gap-4 p-4">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">{t(`docs.sources.${server.id}.name`)}</span>
                <StatusBadge server={server} />
              </div>
              <p className="mt-0.5 text-sm text-muted-foreground">
                {server.required
                  ? t("docs.alwaysOn", { description: t(`docs.sources.${server.id}.description`) })
                  : t(`docs.sources.${server.id}.description`)}
              </p>
              {server.state === "error" && server.error && (
                <p className="mt-1 text-xs text-destructive">{server.error}</p>
              )}
            </div>
            <Switch
              checked={server.enabled}
              disabled={server.required || toggle.isPending}
              onCheckedChange={(enabled) => toggle.mutate({ id: server.id, enabled })}
              aria-label={t(`docs.sources.${server.id}.name`)}
            />
          </div>
        ))}
    </div>
  );
}

function StatusBadge({ server }: { server: McpServerInfo }) {
  const { t } = useTranslation();
  switch (server.state) {
    case "ready":
      return (
        <Badge className="bg-success text-white">
          {t("docs.status.ready", { count: server.toolCount })}
        </Badge>
      );
    case "connecting":
      return <Badge variant="secondary">{t("docs.status.connecting")}</Badge>;
    case "error":
      return <Badge variant="destructive">{t("docs.status.error")}</Badge>;
    case "disabled":
      return <Badge variant="outline">{t("docs.status.disabled")}</Badge>;
  }
}
