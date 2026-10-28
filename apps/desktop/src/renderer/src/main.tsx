import "./styles.css";
import "./i18n";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { mcpKey } from "./components/docs-settings";
import { eplanStatusKey } from "./components/eplan-indicator";
import { ErrorBoundary } from "./components/error-screen";
import { updateStatusKey } from "./components/update-notice";
import { router } from "./router";
import { loadSavedSessions, useSessions } from "./state/sessions";

// Follow the Windows light/dark setting.
const darkQuery = window.matchMedia("(prefers-color-scheme: dark)");
const applyTheme = (): void => {
  document.documentElement.classList.toggle("dark", darkQuery.matches);
};
applyTheme();
darkQuery.addEventListener("change", applyTheme);

const queryClient = new QueryClient();

// Subscriptions for the app's lifetime. Chat events and approval requests go to whichever
// session owns the turn; MCP, EPLAN and update status go straight into the query cache.
window.bochica.chat.onEvent((event) => useSessions.getState().applyEvent(event));
window.bochica.approvals.onRequest((request) => useSessions.getState().addApproval(request));
window.bochica.mcp.onChange((servers) => queryClient.setQueryData(mcpKey, servers));
window.bochica.eplan.onStatus((status) => queryClient.setQueryData(eplanStatusKey, status));
window.bochica.updates.onStatus((status) => queryClient.setQueryData(updateStatusKey, status));
void loadSavedSessions();

const root = document.getElementById("root");
if (!root) throw new Error("Missing #root element");

createRoot(root).render(
  <StrictMode>
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </ErrorBoundary>
  </StrictMode>,
);
