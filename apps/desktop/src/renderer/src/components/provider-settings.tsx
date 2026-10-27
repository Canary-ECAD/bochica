import { type Provider, providers } from "@bochica/agent/catalog";
import type { ConnectionResult, CredentialInfo } from "@bochica/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CircleAlert, CircleCheck, ExternalLink, LoaderCircle } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { credentialsKey } from "@/state/model-choice";

/** Electron prefixes errors thrown in main; the user only needs the message itself. */
function errorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, "");
}

export function ProviderSettings() {
  const credentials = useQuery({
    queryKey: credentialsKey,
    queryFn: () => window.bochica.credentials.list(),
  });

  return (
    <div className="flex flex-col gap-3">
      {providers.map((provider) => (
        <ProviderCard
          key={provider.id}
          provider={provider}
          credentials={(credentials.data ?? []).filter((c) => c.provider === provider.id)}
        />
      ))}
    </div>
  );
}

function ProviderCard({
  provider,
  credentials,
}: {
  provider: Provider;
  credentials: CredentialInfo[];
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState("");

  const saved = credentials.find((c) => c.source === "app");
  const fromEnv = credentials.find((c) => c.source === "env");
  const active = saved ?? fromEnv;

  const refresh = (list: CredentialInfo[]): void => {
    queryClient.setQueryData(credentialsKey, list);
    void queryClient.invalidateQueries({ queryKey: ["models", provider.id] });
  };
  const save = useMutation({
    mutationFn: (secret: string) =>
      window.bochica.credentials.set({ provider: provider.id, secret }),
    onSuccess: (list) => {
      refresh(list);
      setDraft("");
      test.reset();
    },
  });
  const remove = useMutation({
    mutationFn: (id: string) => window.bochica.credentials.remove(id),
    onSuccess: (list) => {
      refresh(list);
      test.reset();
    },
  });
  const test = useMutation({
    mutationFn: () => window.bochica.credentials.test(provider.id),
    onSettled: () => queryClient.invalidateQueries({ queryKey: credentialsKey }),
  });

  const failure = save.error ?? remove.error ?? test.error;

  return (
    <Card className="gap-4 py-4">
      <CardHeader className="px-4">
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="text-sm">{provider.label}</CardTitle>
          <StatusBadge provider={provider} credential={active} />
        </div>
        {provider.auth === "local" ? (
          <CardDescription>
            {t("providers.localDescription", { url: provider.baseUrl })}
          </CardDescription>
        ) : (
          fromEnv &&
          !saved && (
            <CardDescription>{t("providers.fromEnv", { name: fromEnv.preview })}</CardDescription>
          )
        )}
      </CardHeader>

      <CardContent className="flex flex-col gap-3 px-4">
        {provider.auth === "api_key" && (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (draft.trim()) save.mutate(draft);
            }}
            className="flex items-center gap-2"
          >
            <Input
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder={saved ? saved.preview : t("providers.pasteKey")}
              aria-label={t("providers.keyLabel", { provider: provider.label })}
            />
            <Button type="submit" disabled={!draft.trim() || save.isPending}>
              {t("providers.save")}
            </Button>
          </form>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => test.mutate()}
            disabled={test.isPending || (provider.auth === "api_key" && !active)}
          >
            {test.isPending && <LoaderCircle className="animate-spin" />}
            {t("providers.test")}
          </Button>
          {saved && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => remove.mutate(saved.id)}
              disabled={remove.isPending}
            >
              {t("providers.remove")}
            </Button>
          )}
          {provider.keyUrl && (
            <a
              href={provider.keyUrl}
              target="_blank"
              rel="noreferrer"
              className="ml-auto inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            >
              {t("providers.whereToGetKey")}
              <ExternalLink className="size-3" />
            </a>
          )}
        </div>

        {test.data && <TestResult provider={provider} result={test.data} />}
        {failure && (
          <p className="flex items-center gap-2 text-sm text-destructive" role="alert">
            <CircleAlert className="size-4 shrink-0" />
            {errorMessage(failure)}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function StatusBadge({
  provider,
  credential,
}: {
  provider: Provider;
  credential: CredentialInfo | undefined;
}) {
  const { t } = useTranslation();
  if (provider.auth === "local")
    return <Badge variant="secondary">{t("providers.status.local")}</Badge>;
  if (!credential) return <Badge variant="outline">{t("providers.status.noKey")}</Badge>;
  if (credential.status === "ok") {
    return <Badge className="bg-success text-white">{t("providers.status.ok")}</Badge>;
  }
  if (credential.status === "invalid") {
    return <Badge variant="destructive">{t("providers.status.invalid")}</Badge>;
  }
  return <Badge variant="secondary">{t("providers.status.unknown")}</Badge>;
}

function TestResult({ provider, result }: { provider: Provider; result: ConnectionResult }) {
  const { t } = useTranslation();
  const values = { provider: provider.label };
  if (result.status === "ok") {
    return (
      <p className="flex items-center gap-2 text-sm text-success" role="status">
        <CircleCheck className="size-4 shrink-0" />
        {t("providers.result.ok", values)}
      </p>
    );
  }
  const message =
    result.status === "error"
      ? t("providers.result.error", { ...values, code: result.httpStatus })
      : result.status === "network_error" && provider.auth === "local"
        ? t("providers.result.localUnreachable", values)
        : t(`providers.result.${result.status}`, values);
  return (
    <p className="flex items-center gap-2 text-sm text-destructive" role="alert">
      <CircleAlert className="size-4 shrink-0" />
      {message}
    </p>
  );
}
