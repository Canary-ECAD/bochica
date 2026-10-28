import { providers } from "@bochica/agent/catalog";
import type { ProviderId } from "@bochica/shared";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { CircleCheck, MessageSquareText, ShieldCheck, Wrench } from "lucide-react";
import { type ReactNode, useState } from "react";
import { useTranslation } from "react-i18next";
import logo from "@/assets/logo.png";
import { EplanDot, EplanStatusDetails, useEplanStatus } from "@/components/eplan-indicator";
import { ProviderCard } from "@/components/provider-settings";
import { Button } from "@/components/ui/button";
import { supportedLanguages } from "@/i18n";
import { cn } from "@/lib/utils";
import { useMode } from "@/state/mode";
import { credentialsKey, useModelChoice } from "@/state/model-choice";
import { startSessionWith } from "@/state/permission";
import { sendMessage, useSessions } from "@/state/sessions";

// The first-run guide: what Bochica is, a model to talk to, whether EPLAN is reachable, and a
// first question. Shown instead of the app until it is finished or skipped.

export const onboardingKey = ["onboarding"] as const;

const STEPS = ["welcome", "model", "eplan", "try"] as const;

export function Welcome() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const createSession = useSessions((state) => state.createSession);
  const { choice } = useModelChoice();
  const folder = useQuery({
    queryKey: ["folders", "default"],
    queryFn: () => window.bochica.folders.default(),
  });
  const [step, setStep] = useState(0);
  const next = () => setStep((s) => Math.min(s + 1, STEPS.length - 1));
  const back = () => setStep((s) => Math.max(s - 1, 0));

  const finish = async (question?: string): Promise<void> => {
    await window.bochica.onboarding.set({ done: true });
    if (question && choice) {
      // The sample question is about EPLAN itself: Consult answers it from the documentation.
      useMode.getState().setMode("consult");
      const sessionId = createSession(folder.data);
      startSessionWith(sessionId);
      sendMessage(sessionId, question, choice);
      await navigate({ to: "/session/$sessionId", params: { sessionId } });
    } else {
      await navigate({ to: "/" });
    }
    queryClient.setQueryData(onboardingKey, { done: true });
  };

  const name = STEPS[step] ?? "welcome";
  return (
    <div className="flex h-screen flex-col items-center overflow-y-auto px-6 py-10">
      <div className="flex w-full max-w-xl flex-1 flex-col">
        <div className="mb-10 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <img src={logo} alt="" className="size-8" />
            <span className="font-semibold">Bochica</span>
          </div>
          <ol className="flex gap-1.5" aria-label={t("welcome.progress", { step: step + 1 })}>
            {STEPS.map((s, i) => (
              <li
                key={s}
                className={cn("h-1.5 w-6 rounded-full", i <= step ? "bg-primary" : "bg-muted")}
              />
            ))}
          </ol>
        </div>

        {name === "welcome" && <WelcomeStep onNext={next} />}
        {name === "model" && (
          <ModelStep ready={choice !== null} onBack={back} onNext={next} onSkip={next} />
        )}
        {name === "eplan" && <EplanStep onBack={back} onNext={next} />}
        {name === "try" && (
          <TryStep
            ready={choice !== null}
            onBack={back}
            onAsk={(question) => void finish(question)}
            onFinish={() => void finish()}
          />
        )}
      </div>
    </div>
  );
}

function Step({
  title,
  description,
  children,
  actions,
}: {
  title: string;
  description: string;
  children?: ReactNode;
  actions: ReactNode;
}) {
  return (
    <section className="flex flex-1 flex-col">
      <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      <p className="mt-2 text-muted-foreground">{description}</p>
      <div className="mt-6 flex-1">{children}</div>
      <div className="mt-8 flex items-center justify-end gap-2">{actions}</div>
    </section>
  );
}

function WelcomeStep({ onNext }: { onNext(): void }) {
  const { t, i18n } = useTranslation();
  const points = [
    { icon: MessageSquareText, text: t("welcome.intro.ask") },
    { icon: Wrench, text: t("welcome.intro.work") },
    { icon: ShieldCheck, text: t("welcome.intro.safe") },
  ];
  return (
    <Step
      title={t("welcome.intro.title")}
      description={t("welcome.intro.description")}
      actions={<Button onClick={onNext}>{t("welcome.start")}</Button>}
    >
      <ul className="flex flex-col gap-3">
        {points.map(({ icon: Icon, text }) => (
          <li key={text} className="flex items-start gap-3 text-sm">
            <Icon className="mt-0.5 size-4 shrink-0 text-primary" />
            {text}
          </li>
        ))}
      </ul>
      <label className="mt-8 flex items-center justify-between gap-4 rounded-lg border p-4">
        <span className="text-sm">{t("settings.language")}</span>
        <select
          value={i18n.resolvedLanguage}
          onChange={(event) => void i18n.changeLanguage(event.target.value)}
          className="h-9 rounded-md border bg-background px-2 text-sm"
        >
          {supportedLanguages.map((lang) => (
            <option key={lang.code} value={lang.code}>
              {lang.label}
            </option>
          ))}
        </select>
      </label>
      <p className="mt-6 text-xs text-muted-foreground">{t("settings.disclaimer")}</p>
    </Step>
  );
}

function ModelStep({
  ready,
  onBack,
  onNext,
  onSkip,
}: {
  ready: boolean;
  onBack(): void;
  onNext(): void;
  onSkip(): void;
}) {
  const { t } = useTranslation();
  const credentials = useQuery({
    queryKey: credentialsKey,
    queryFn: () => window.bochica.credentials.list(),
  });
  const [picked, setPicked] = useState<ProviderId | null>(null);
  const selected =
    picked ?? credentials.data?.[0]?.provider ?? providers[0]?.id ?? ("anthropic" as const);
  const provider = providers.find((p) => p.id === selected);

  return (
    <Step
      title={t("welcome.model.title")}
      description={t("welcome.model.description")}
      actions={
        <>
          <Button variant="ghost" className="mr-auto" onClick={onBack}>
            {t("welcome.back")}
          </Button>
          {!ready && (
            <Button variant="ghost" onClick={onSkip}>
              {t("welcome.skip")}
            </Button>
          )}
          <Button disabled={!ready} onClick={onNext}>
            {t("welcome.continue")}
          </Button>
        </>
      }
    >
      <div className="mb-4 flex flex-wrap gap-2" role="radiogroup">
        {providers.map((p) => (
          <button
            key={p.id}
            type="button"
            role="radio"
            aria-checked={p.id === selected}
            onClick={() => setPicked(p.id)}
            className={cn(
              "rounded-md border px-3 py-1.5 text-sm hover:bg-accent",
              p.id === selected && "border-primary bg-accent",
            )}
          >
            {p.label}
          </button>
        ))}
      </div>
      {provider && (
        <ProviderCard
          key={provider.id}
          provider={provider}
          credentials={(credentials.data ?? []).filter((c) => c.provider === provider.id)}
        />
      )}
      {ready && (
        <p className="mt-4 flex items-center gap-2 text-sm text-success" role="status">
          <CircleCheck className="size-4 shrink-0" />
          {t("welcome.model.ready")}
        </p>
      )}
    </Step>
  );
}

function EplanStep({ onBack, onNext }: { onBack(): void; onNext(): void }) {
  const { t } = useTranslation();
  const status = useEplanStatus();
  return (
    <Step
      title={t("welcome.eplan.title")}
      description={t("welcome.eplan.description")}
      actions={
        <>
          <Button variant="ghost" className="mr-auto" onClick={onBack}>
            {t("welcome.back")}
          </Button>
          <Button onClick={onNext}>{t("welcome.continue")}</Button>
        </>
      }
    >
      <div className="rounded-lg border p-4 text-sm">
        <p className="flex items-center gap-2 font-medium">
          <EplanDot status={status} />
          {t(`eplan.label.${status?.state ?? "starting"}`, { version: status?.version ?? "" })}
        </p>
        <EplanStatusDetails status={status} />
      </div>
    </Step>
  );
}

function TryStep({
  ready,
  onBack,
  onAsk,
  onFinish,
}: {
  ready: boolean;
  onBack(): void;
  onAsk(question: string): void;
  onFinish(): void;
}) {
  const { t } = useTranslation();
  const question = t("welcome.try.question");
  return (
    <Step
      title={t("welcome.try.title")}
      description={t("welcome.try.description")}
      actions={
        <>
          <Button variant="ghost" className="mr-auto" onClick={onBack}>
            {t("welcome.back")}
          </Button>
          <Button variant="outline" onClick={onFinish}>
            {t("welcome.finish")}
          </Button>
          <Button disabled={!ready} onClick={() => onAsk(question)}>
            {t("welcome.try.ask")}
          </Button>
        </>
      }
    >
      <blockquote className="rounded-lg border bg-muted/40 p-4 text-sm">{question}</blockquote>
      {!ready && <p className="mt-3 text-sm text-muted-foreground">{t("welcome.try.noModel")}</p>}
    </Step>
  );
}
