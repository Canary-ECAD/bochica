import { type Provider, providers } from "@bochica/agent/catalog";
import type { ConnectionResult, CredentialInfo, LoginResult } from "@bochica/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowDown,
  ArrowUp,
  CircleAlert,
  CircleCheck,
  ExternalLink,
  LoaderCircle,
  LogIn,
  Pencil,
  Trash2,
} from "lucide-react";
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

/** The key main calls first: the first one that isn't rejected or paused, else the first. */
function keyInUse(credentials: CredentialInfo[]): CredentialInfo | undefined {
  return (
    credentials.find((c) => c.status !== "invalid" && c.limitedUntil === undefined) ??
    credentials[0]
  );
}

export function ProviderSettings() {
  const credentials = useQuery({
    queryKey: credentialsKey,
    queryFn: () => window.bochica.credentials.list(),
    // A paused key comes back on its own; look again so the card says so.
    refetchInterval: (query) =>
      query.state.data?.some((c) => c.limitedUntil !== undefined) ? 30_000 : false,
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

export function ProviderCard({
  provider,
  credentials,
}: {
  provider: Provider;
  credentials: CredentialInfo[];
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [adding, setAdding] = useState(false);

  const saved = credentials.filter((c) => c.source === "app");
  const fromEnv = credentials.find((c) => c.source === "env");
  const active = keyInUse(credentials);

  const refresh = (list: CredentialInfo[]): void => {
    queryClient.setQueryData(credentialsKey, list);
    void queryClient.invalidateQueries({ queryKey: ["models", provider.id] });
  };
  const test = useMutation({
    mutationFn: () => window.bochica.credentials.test({ provider: provider.id }),
    // Claude Agent's models depend on Claude Code being installed and signed in.
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["models", provider.id] }),
  });

  return (
    <Card className="gap-4 py-4">
      <CardHeader className="px-4">
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="text-sm">{provider.label}</CardTitle>
          {provider.auth === "local" ? (
            <Badge variant="secondary">{t("providers.status.local")}</Badge>
          ) : provider.auth === "claude_code" ? (
            <Badge variant="secondary">{t("providers.status.plan")}</Badge>
          ) : (
            <StatusBadge credential={active} />
          )}
        </div>
        {provider.auth === "local" ? (
          <CardDescription>
            {t("providers.localDescription", { url: provider.baseUrl })}
          </CardDescription>
        ) : provider.auth === "claude_code" ? (
          <CardDescription className="flex flex-col gap-2">
            <span>{t("providers.claudeAgent.description")}</span>
            <span>{t("providers.claudeAgent.steps")}</span>
            <span className="text-xs">{t("providers.claudeAgent.unofficial")}</span>
          </CardDescription>
        ) : (
          saved.length === 0 &&
          fromEnv && (
            <CardDescription>{t("providers.fromEnv", { name: fromEnv.preview })}</CardDescription>
          )
        )}
      </CardHeader>

      <CardContent className="flex flex-col gap-3 px-4">
        {provider.auth !== "api_key" ? (
          <div className="flex flex-col gap-2">
            <div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => test.mutate()}
                disabled={test.isPending}
              >
                {test.isPending && <LoaderCircle className="animate-spin" />}
                {t("providers.test")}
              </Button>
            </div>
            {test.data && <TestResult provider={provider} result={test.data} />}
          </div>
        ) : (
          <>
            {credentials.length > 0 && (
              <ul className="flex flex-col divide-y rounded-md border">
                {credentials.map((credential) => (
                  <KeyRow
                    key={credential.id}
                    provider={provider}
                    credential={credential}
                    inUse={credentials.length > 1 && credential.id === active?.id}
                    position={saved.indexOf(credential)}
                    appKeys={saved.length}
                    onChange={refresh}
                  />
                ))}
              </ul>
            )}
            {saved.length === 0 || adding ? (
              <AddKey
                provider={provider}
                count={saved.length}
                onSaved={(list) => {
                  refresh(list);
                  setAdding(false);
                }}
                {...(saved.length > 0 ? { onCancel: () => setAdding(false) } : {})}
              />
            ) : (
              <div>
                <Button variant="ghost" size="sm" onClick={() => setAdding(true)}>
                  {t("providers.addKey")}
                </Button>
              </div>
            )}
            {provider.login && <SignIn provider={provider} onSaved={refresh} />}
          </>
        )}

        {provider.setupUrl && (
          <a
            href={provider.setupUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 self-end text-xs text-muted-foreground hover:text-foreground"
          >
            {t("providers.claudeAgent.install")}
            <ExternalLink className="size-3" />
          </a>
        )}
        {provider.keyUrl && (
          <a
            href={provider.keyUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 self-end text-xs text-muted-foreground hover:text-foreground"
          >
            {t("providers.whereToGetKey")}
            <ExternalLink className="size-3" />
          </a>
        )}
      </CardContent>
    </Card>
  );
}

function KeyRow({
  provider,
  credential,
  inUse,
  position,
  appKeys,
  onChange,
}: {
  provider: Provider;
  credential: CredentialInfo;
  inUse: boolean;
  /** Place among the provider's app keys; -1 for environment keys. */
  position: number;
  /** How many app keys the provider has; the arrows show only with two or more. */
  appKeys: number;
  onChange(list: CredentialInfo[]): void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [renaming, setRenaming] = useState<string | null>(null);
  const app = credential.source === "app";

  const update = useMutation({
    mutationFn: (change: { label?: string; position?: number }) =>
      window.bochica.credentials.update({ id: credential.id, ...change }),
    onSuccess: (list) => {
      onChange(list);
      setRenaming(null);
    },
  });
  const remove = useMutation({
    mutationFn: () => window.bochica.credentials.remove(credential.id),
    onSuccess: onChange,
  });
  const test = useMutation({
    mutationFn: () => window.bochica.credentials.test({ provider: provider.id, id: credential.id }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: credentialsKey }),
  });
  const failure = update.error ?? remove.error ?? test.error;

  return (
    <li className="flex flex-col gap-2 px-3 py-2">
      <div className="flex items-center gap-2">
        <div className="flex min-w-0 flex-1 flex-col">
          {renaming === null ? (
            <span className="flex items-center gap-2 truncate text-sm font-medium">
              {credential.label}
              {inUse && (
                <span className="text-xs font-normal text-muted-foreground">
                  {t("providers.inUse")}
                </span>
              )}
            </span>
          ) : (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                if (renaming.trim()) update.mutate({ label: renaming.trim() });
              }}
            >
              <Input
                autoFocus
                className="h-7"
                value={renaming}
                maxLength={60}
                onChange={(event) => setRenaming(event.target.value)}
                onKeyDown={(event) => event.key === "Escape" && setRenaming(null)}
                onBlur={() => setRenaming(null)}
                aria-label={t("providers.rename")}
              />
            </form>
          )}
          <span className="truncate font-mono text-xs text-muted-foreground">
            {app ? credential.preview : t("providers.envVariable", { name: credential.preview })}
          </span>
        </div>
        <StatusBadge credential={credential} />
        <div className="flex items-center">
          {app && appKeys > 1 && (
            <>
              <Button
                variant="ghost"
                size="icon"
                className="size-7"
                disabled={position === 0 || update.isPending}
                onClick={() => update.mutate({ position: position - 1 })}
                aria-label={t("providers.moveUp")}
                title={t("providers.moveUp")}
              >
                <ArrowUp />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="size-7"
                disabled={position === appKeys - 1 || update.isPending}
                onClick={() => update.mutate({ position: position + 1 })}
                aria-label={t("providers.moveDown")}
                title={t("providers.moveDown")}
              >
                <ArrowDown />
              </Button>
            </>
          )}
          {app && (
            <Button
              variant="ghost"
              size="icon"
              className="size-7"
              onClick={() => setRenaming(credential.label)}
              aria-label={t("providers.rename")}
              title={t("providers.rename")}
            >
              <Pencil />
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2"
            onClick={() => test.mutate()}
            disabled={test.isPending}
          >
            {test.isPending && <LoaderCircle className="animate-spin" />}
            {t("providers.testKey")}
          </Button>
          {app && (
            <Button
              variant="ghost"
              size="icon"
              className="size-7"
              onClick={() => remove.mutate()}
              disabled={remove.isPending}
              aria-label={t("providers.remove")}
              title={t("providers.remove")}
            >
              <Trash2 />
            </Button>
          )}
        </div>
      </div>
      {test.data && <TestResult provider={provider} result={test.data} />}
      {failure && <Failure message={errorMessage(failure)} />}
    </li>
  );
}

function AddKey({
  provider,
  count,
  onSaved,
  onCancel,
}: {
  provider: Provider;
  /** App keys the provider has; the new one's default label is the next number. */
  count: number;
  onSaved(list: CredentialInfo[]): void;
  onCancel?: () => void;
}) {
  const { t } = useTranslation();
  const [secret, setSecret] = useState("");
  const [label, setLabel] = useState("");
  const fallback = t("providers.defaultLabel", { n: count + 1 });

  const save = useMutation({
    mutationFn: () =>
      window.bochica.credentials.set({
        provider: provider.id,
        secret,
        label: label.trim() || fallback,
      }),
    onSuccess: (list) => {
      setSecret("");
      setLabel("");
      onSaved(list);
    },
  });

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (secret.trim()) save.mutate();
      }}
      className="flex flex-col gap-2"
    >
      <div className="flex items-center gap-2">
        {count > 0 && (
          <Input
            className="w-36"
            value={label}
            maxLength={60}
            onChange={(event) => setLabel(event.target.value)}
            placeholder={fallback}
            aria-label={t("providers.labelField")}
          />
        )}
        <Input
          type="password"
          autoComplete="off"
          spellCheck={false}
          value={secret}
          onChange={(event) => setSecret(event.target.value)}
          placeholder={t("providers.pasteKey")}
          aria-label={t("providers.keyLabel", { provider: provider.label })}
        />
        <Button type="submit" disabled={!secret.trim() || save.isPending}>
          {t("providers.save")}
        </Button>
        {onCancel && (
          <Button type="button" variant="ghost" onClick={onCancel}>
            {t("providers.cancel")}
          </Button>
        )}
      </div>
      {save.error && <Failure message={errorMessage(save.error)} />}
    </form>
  );
}

function SignIn({
  provider,
  onSaved,
}: {
  provider: Provider;
  onSaved(list: CredentialInfo[]): void;
}) {
  const { t } = useTranslation();
  const values = { provider: provider.label };
  const login = useMutation({
    mutationFn: () =>
      window.bochica.credentials.login({
        provider: provider.id,
        label: t("providers.signIn.label", values),
        page: {
          done: t("providers.signIn.pageDone", values),
          failed: t("providers.signIn.pageFailed", values),
        },
      }),
    onSuccess: (result: LoginResult) => {
      if (result.status === "ok") onSaved(result.credentials);
    },
  });
  const result = login.data;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => login.mutate()}
          disabled={login.isPending}
        >
          {login.isPending ? <LoaderCircle className="animate-spin" /> : <LogIn />}
          {t("providers.signIn.button", values)}
        </Button>
        {login.isPending && (
          <>
            <span className="text-xs text-muted-foreground">{t("providers.signIn.waiting")}</span>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void window.bochica.credentials.cancelLogin()}
            >
              {t("providers.cancel")}
            </Button>
          </>
        )}
      </div>
      {result?.status === "ok" && (
        <p className="flex items-center gap-2 text-sm text-success" role="status">
          <CircleCheck className="size-4 shrink-0" />
          {t("providers.signIn.ok", values)}
        </p>
      )}
      {result && result.status !== "ok" && result.status !== "cancelled" && (
        <Failure message={t(`providers.signIn.${result.status}`, values)} />
      )}
      {login.error && <Failure message={errorMessage(login.error)} />}
    </div>
  );
}

function StatusBadge({ credential }: { credential: CredentialInfo | undefined }) {
  const { t, i18n } = useTranslation();
  if (!credential) return <Badge variant="outline">{t("providers.status.noKey")}</Badge>;
  if (credential.limitedUntil !== undefined) {
    const time = new Date(credential.limitedUntil).toLocaleTimeString(i18n.language, {
      hour: "2-digit",
      minute: "2-digit",
    });
    return <Badge variant="secondary">{t("providers.status.paused", { time })}</Badge>;
  }
  if (credential.status === "ok") {
    return <Badge className="bg-success text-white">{t("providers.status.ok")}</Badge>;
  }
  if (credential.status === "invalid") {
    return <Badge variant="destructive">{t("providers.status.invalid")}</Badge>;
  }
  return <Badge variant="secondary">{t("providers.status.unknown")}</Badge>;
}

function Failure({ message }: { message: string }) {
  return (
    <p className="flex items-center gap-2 text-sm text-destructive" role="alert">
      <CircleAlert className="size-4 shrink-0" />
      {message}
    </p>
  );
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
  return <Failure message={message} />;
}
