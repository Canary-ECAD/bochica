import { TriangleAlert } from "lucide-react";
import { Component, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";

/** Shown instead of a blank window when rendering fails. */
export function ErrorScreen() {
  const { t } = useTranslation();
  return (
    <div className="flex h-full min-h-screen flex-1 flex-col items-center justify-center gap-4 px-6 text-center">
      <TriangleAlert className="size-8 text-primary" />
      <div>
        <h1 className="text-lg font-medium">{t("error.title")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t("error.description")}</p>
      </div>
      <Button onClick={() => window.location.reload()}>{t("error.reload")}</Button>
    </div>
  );
}

/** Catches errors outside the router (the router has its own `defaultErrorComponent`). */
export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  override render(): ReactNode {
    return this.state.failed ? <ErrorScreen /> : this.props.children;
  }
}
