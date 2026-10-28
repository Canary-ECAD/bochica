import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Composer } from "@/components/composer";
import { greeting } from "@/lib/greeting";
import { useFolder } from "@/state/folder";
import { setPermission, startSessionWith, usePermission } from "@/state/permission";
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
  const permission = usePermission((state) => state.next);

  return (
    <div className="flex flex-1 flex-col items-center justify-center px-6">
      <div className="w-full max-w-2xl">
        <h1 className="mb-8 text-center text-4xl font-semibold tracking-tight">{heading}</h1>
        <Composer
          autoFocus
          folder={folder}
          permission={permission}
          onPermission={(mode) => setPermission(undefined, mode)}
          onPickFolder={() => {
            void window.bochica.folders.pick(folder).then((chosen) => {
              if (chosen) setFolder(chosen);
            });
          }}
          onSend={(text, choice) => {
            const sessionId = createSession(folder);
            startSessionWith(sessionId);
            sendMessage(sessionId, text, choice);
            void navigate({ to: "/session/$sessionId", params: { sessionId } });
          }}
        />
      </div>
    </div>
  );
}
