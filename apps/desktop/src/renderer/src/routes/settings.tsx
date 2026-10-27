import { useTranslation } from "react-i18next";
import { supportedLanguages } from "@/i18n";

export function SettingsPage() {
  const { t, i18n } = useTranslation();

  return (
    <div className="mx-auto w-full max-w-2xl px-6 py-10">
      <h1 className="mb-8 text-xl font-medium">{t("settings.title")}</h1>

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

      <p className="mt-10 text-xs text-muted-foreground">{t("settings.disclaimer")}</p>
    </div>
  );
}
