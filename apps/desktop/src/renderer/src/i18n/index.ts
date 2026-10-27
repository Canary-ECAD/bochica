import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import en from "./en.json";
import es from "./es.json";

// A new language is a new JSON file plus an entry here. en.json is the reference: every other
// file must have the same keys.

export const supportedLanguages = [
  { code: "en", label: "English" },
  { code: "es", label: "Español" },
] as const;

const systemLanguage = navigator.language.split("-")[0] ?? "en";

void i18n.use(initReactI18next).init({
  resources: { en: { translation: en }, es: { translation: es } },
  lng: supportedLanguages.some((l) => l.code === systemLanguage) ? systemLanguage : "en",
  fallbackLng: "en",
  interpolation: { escapeValue: false },
});
