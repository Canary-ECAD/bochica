import "./styles.css";
import "./i18n";
import type { UpdateStatus } from "@bochica/shared";
import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { useTranslation } from "react-i18next";
import logo from "@/assets/logo.png";

// The update window (`main/update-window.ts`): a page of its own, so it starts fast and loads
// nothing of the app. The helper that bridges the install draws the same window in WinForms
// (`resources/update-helper.ps1`); keep the two alike.

const darkQuery = window.matchMedia("(prefers-color-scheme: dark)");
const applyTheme = (): void => {
  document.documentElement.classList.toggle("dark", darkQuery.matches);
};
applyTheme();
darkQuery.addEventListener("change", applyTheme);

function UpdateWindow() {
  const { t } = useTranslation();
  const [status, setStatus] = useState<UpdateStatus | null>(null);
  useEffect(() => {
    const unsubscribe = window.bochica.updates.onStatus(setStatus);
    void window.bochica.updates.status().then(setStatus);
    return unsubscribe;
  }, []);
  const downloading = status?.state === "downloading";
  const percent = status?.percent ?? 0;

  return (
    <main className="flex h-screen select-none flex-col justify-center gap-3 border bg-background px-6 text-foreground [-webkit-app-region:drag]">
      <div className="flex items-center gap-3">
        <img src={logo} alt="" className="size-9 shrink-0" />
        <div className="min-w-0">
          <p className="truncate font-semibold">
            {t("updates.window.title", { version: status?.version ?? "" })}
          </p>
          <p className="text-sm text-muted-foreground">
            {downloading ? t("updates.downloading", { percent }) : t("updates.window.preparing")}
          </p>
        </div>
      </div>
      <div className="h-1 overflow-hidden rounded-full bg-muted">
        {downloading ? (
          <div className="h-full bg-primary" style={{ width: `${percent}%` }} />
        ) : (
          <div className="h-full w-1/3 animate-pulse bg-primary" />
        )}
      </div>
      <p className="text-xs text-muted-foreground">{t("updates.window.note")}</p>
    </main>
  );
}

const root = document.getElementById("root");
if (!root) throw new Error("Missing #root element");
createRoot(root).render(
  <StrictMode>
    <UpdateWindow />
  </StrictMode>,
);
