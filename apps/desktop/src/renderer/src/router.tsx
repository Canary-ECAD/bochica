import {
  createHashHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { AppShell } from "./components/app-shell";
import { ErrorScreen } from "./components/error-screen";
import { SessionPage } from "./routes/session";
import { SettingsPage } from "./routes/settings";

// Hash history: the packaged app loads index.html from disk, where path-based URLs don't resolve.

const rootRoute = createRootRoute({ component: AppShell });

const sessionRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: SessionPage,
});

const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/settings",
  component: SettingsPage,
});

export const router = createRouter({
  routeTree: rootRoute.addChildren([sessionRoute, settingsRoute]),
  history: createHashHistory(),
  defaultErrorComponent: ErrorScreen,
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
