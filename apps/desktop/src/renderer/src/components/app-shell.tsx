import { useQuery } from "@tanstack/react-query";
import { Link, Outlet } from "@tanstack/react-router";
import { MessageSquarePlus, Settings } from "lucide-react";
import { useTranslation } from "react-i18next";
import { EplanIndicator } from "@/components/eplan-indicator";
import { SessionRow } from "@/components/session-row";
import { useSessions } from "@/state/sessions";

const navItem =
  "flex items-center gap-2 rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground [&.active]:bg-accent [&.active]:text-accent-foreground [&_svg]:size-4";

export function AppShell() {
  const { t } = useTranslation();
  const appInfo = useQuery({
    queryKey: ["app-info"],
    queryFn: () => window.bochica.getAppInfo(),
  });
  const order = useSessions((state) => state.order);
  const sessions = useSessions((state) => state.sessions);

  return (
    <div className="flex h-screen">
      <aside className="flex w-64 shrink-0 flex-col border-r bg-sidebar p-3">
        <div className="px-3 pt-1 pb-4">
          <div className="text-base font-semibold">Bochica</div>
          <div className="text-xs text-muted-foreground">by Canary-ECAD</div>
        </div>

        <nav className="flex flex-col gap-1">
          <Link to="/" activeOptions={{ exact: true }} className={navItem}>
            <MessageSquarePlus />
            {t("nav.newSession")}
          </Link>
        </nav>

        <div className="mt-4 px-3 text-xs font-medium text-muted-foreground">{t("nav.recent")}</div>
        <nav className="-mx-1 mt-1 flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-1">
          {order.length === 0 ? (
            <p className="px-3 py-2 text-xs text-muted-foreground">{t("nav.noSessions")}</p>
          ) : (
            order.map((id) => <SessionRow key={id} id={id} title={sessions[id]?.title ?? ""} />)
          )}
        </nav>

        <div className="mt-3 flex flex-col gap-1">
          <EplanIndicator />
          <Link to="/settings" className={navItem}>
            <Settings />
            {t("nav.settings")}
          </Link>
          {appInfo.data && (
            <div className="px-3 pt-2 text-xs text-muted-foreground">v{appInfo.data.version}</div>
          )}
        </div>
      </aside>

      <main className="flex min-w-0 flex-1 flex-col">
        <Outlet />
      </main>
    </div>
  );
}
