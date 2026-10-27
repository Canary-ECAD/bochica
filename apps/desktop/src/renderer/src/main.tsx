import "./styles.css";
import "./i18n";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ErrorBoundary } from "./components/error-screen";
import { router } from "./router";
import { useSessions } from "./state/sessions";

// Follow the Windows light/dark setting.
const darkQuery = window.matchMedia("(prefers-color-scheme: dark)");
const applyTheme = (): void => {
  document.documentElement.classList.toggle("dark", darkQuery.matches);
};
applyTheme();
darkQuery.addEventListener("change", applyTheme);

const queryClient = new QueryClient();

// One subscription for the app's lifetime: chat events update whichever session owns the turn.
window.bochica.chat.onEvent((event) => useSessions.getState().applyEvent(event));

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
