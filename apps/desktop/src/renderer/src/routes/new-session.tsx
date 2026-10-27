import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Composer } from "@/components/composer";
import { greeting } from "@/lib/greeting";
import { sendMessage, useSessions } from "@/state/sessions";

export function NewSessionPage() {
  const { t, i18n } = useTranslation();
  // Picked once per visit, so it doesn't change while the user is typing.
  const [heading] = useState(() => greeting(t, i18n.language));
  const navigate = useNavigate();
  const createSession = useSessions((state) => state.createSession);

  return (
    <div className="flex flex-1 flex-col items-center justify-center px-6">
      <div className="w-full max-w-2xl">
        <h1 className="mb-8 text-center text-4xl font-semibold tracking-tight">{heading}</h1>
        <Composer
          autoFocus
          onSend={(text, choice) => {
            const sessionId = createSession();
            sendMessage(sessionId, text, choice);
            void navigate({ to: "/session/$sessionId", params: { sessionId } });
          }}
        />
      </div>
    </div>
  );
}
