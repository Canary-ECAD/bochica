import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { DocsSettings } from "@/components/docs-settings";
import { PermissionsSettings } from "@/components/permissions-settings";
import { ProviderSettings } from "@/components/provider-settings";
import { SkillsSettings } from "@/components/skills-settings";
import { Button } from "@/components/ui/button";
import { onboardingKey } from "@/components/welcome";
import { supportedLanguages } from "@/i18n";

export function SettingsPage() {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-2xl px-6 py-10">
        <h1 className="mb-8 text-xl font-medium">{t("settings.title")}</h1>

        <section className="mb-10">
          <h2 className="mb-1 text-sm font-medium">{t("providers.title")}</h2>
          <p className="mb-4 text-sm text-muted-foreground">{t("providers.description")}</p>
          <ProviderSettings />
        </section>

        <section className="mb-10">
          <h2 className="mb-1 text-sm font-medium">{t("docs.title")}</h2>
          <p className="mb-4 text-sm text-muted-foreground">{t("docs.description")}</p>
          <DocsSettings />
        </section>

        <section className="mb-10">
          <h2 className="mb-1 text-sm font-medium">{t("skills.title")}</h2>
          <p className="mb-4 text-sm text-muted-foreground">{t("skills.description")}</p>
          <SkillsSettings />
        </section>

        <section className="mb-10">
          <h2 className="mb-1 text-sm font-medium">{t("permissions.title")}</h2>
          <p className="mb-4 text-sm text-muted-foreground">{t("permissions.description")}</p>
          <PermissionsSettings />
        </section>

        <section>
          <h2 className="mb-4 text-sm font-medium">{t("settings.general")}</h2>
          <label className="flex items-center justify-between gap-4 rounded-lg border p-4">
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
          <div className="mt-3 flex items-center justify-between gap-4 rounded-lg border p-4">
            <span className="text-sm">{t("settings.welcomeGuide")}</span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                void window.bochica.onboarding
                  .set({ done: false })
                  .then(() => queryClient.setQueryData(onboardingKey, { done: false }));
              }}
            >
              {t("settings.showWelcome")}
            </Button>
          </div>
        </section>

        <p className="mt-10 text-xs text-muted-foreground">{t("settings.disclaimer")}</p>
      </div>
    </div>
  );
}
