import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Composer } from "@/components/composer";
import { greeting } from "@/lib/greeting";
import { useFolder } from "@/state/folder";
import { sendMessage, useSessions } from "@/state/sessions";

export function NewSessionPage() {
  const { t, i18n } = useTranslation();
  // Picked once per visit, so it doesn't change while the user is typing.
  const [heading] = useState(() => greeting(t, i18n.language));
  const navigate = useNavigate();
  const createSession = useSessions((state) => state.createSession);
  const { folder: picked, setFolder } = useFolder();
  const fallback = useQuery({
    queryKey: ["folders", "default"],
    queryFn: () => window.bochica.folders.default(),
  });
  const folder = picked ?? fallback.data;

  return (
    <div className="flex flex-1 flex-col items-center justify-center px-6">
      <div className="w-full max-w-2xl">
        <h1 className="mb-8 text-center text-4xl font-semibold tracking-tight">{heading}</h1>
        <Composer
          autoFocus
          folder={folder}
          onPickFolder={() => {
            void window.bochica.folders.pick(folder).then((chosen) => {
              if (chosen) setFolder(chosen);
            });
          }}
          onSend={(text, choice) => {
            const sessionId = createSession(folder);
            sendMessage(sessionId, text, choice);
            void navigate({ to: "/session/$sessionId", params: { sessionId } });
          }}
        />
      </div>
    </div>
  );
}
