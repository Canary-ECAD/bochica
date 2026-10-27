import { useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { Composer } from "@/components/composer";
import { sendMessage, useSessions } from "@/state/sessions";

export function NewSessionPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const createSession = useSessions((state) => state.createSession);

  return (
    <div className="flex flex-1 flex-col items-center justify-center px-6">
      <div className="w-full max-w-2xl">
        <h1 className="mb-6 text-center text-2xl font-medium">{t("session.greeting")}</h1>
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
