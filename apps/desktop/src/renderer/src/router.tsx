import {
  createHashHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { AppShell } from "./components/app-shell";
import { ErrorScreen } from "./components/error-screen";
import { NewSessionPage } from "./routes/new-session";
import { SessionPage } from "./routes/session";
import { SettingsPage } from "./routes/settings";

// Hash history: the packaged app loads index.html from disk, where path-based URLs don't resolve.

const rootRoute = createRootRoute({ component: AppShell });

const newSessionRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: NewSessionPage,
});

const sessionRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/session/$sessionId",
  component: function SessionRoute() {
    const { sessionId } = sessionRoute.useParams();
    // Keyed so switching sessions resets scroll position and the composer draft.
    return <SessionPage key={sessionId} sessionId={sessionId} />;
  },
});

const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/settings",
  component: SettingsPage,
});

export const router = createRouter({
  routeTree: rootRoute.addChildren([newSessionRoute, sessionRoute, settingsRoute]),
  history: createHashHistory(),
  defaultErrorComponent: ErrorScreen,
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
