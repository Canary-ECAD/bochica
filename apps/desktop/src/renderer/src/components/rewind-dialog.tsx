import type { RewindPreview, RewindRequest } from "@bochica/shared";
import { useMutation, useQuery } from "@tanstack/react-query";
import { LoaderCircle, TriangleAlert } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/** A path inside the session's working folder reads better relative to it. */
function shortPath(path: string, folder: string | undefined): string {
  if (!folder) return path;
  const prefix = folder.replace(/[\\/]+$/, "") + "\\";
  return path.toLowerCase().startsWith(prefix.toLowerCase()) ? path.slice(prefix.length) : path;
}

/**
 * Rewind to one of the user's messages: lists what goes back and what can't be undone, then
 * rewinds the conversation, the files, or both. `onDone` gets the message text back when the
 * conversation was cut, so the composer can offer it again.
 */
export function RewindDialog({
  sessionId,
  messageId,
  text,
  folder,
  onClose,
  onDone,
}: {
  sessionId: string;
  messageId: string;
  text: string;
  folder: string | undefined;
  onClose(): void;
  onDone(restore: RewindRequest["restore"], text: string): void;
}) {
  const { t } = useTranslation();
  const preview = useQuery({
    queryKey: ["rewind", sessionId, messageId],
    queryFn: () => window.bochica.checkpoints.preview({ sessionId, messageId }),
    gcTime: 0,
  });
  const rewind = useMutation({
    mutationFn: (restore: RewindRequest["restore"]) =>
      window.bochica.checkpoints.rewind({ sessionId, messageId, restore }),
    onSuccess: (result, restore) => {
      if (result.failed.length === 0) onDone(restore, text);
    },
  });
  const data = preview.data;
  const failed = rewind.data?.failed ?? [];

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("rewind.title")}</DialogTitle>
          <DialogDescription>{t("rewind.description")}</DialogDescription>
        </DialogHeader>
        <blockquote className="line-clamp-3 rounded-md bg-muted px-3 py-2 text-sm whitespace-pre-wrap">
          {text}
        </blockquote>
        {preview.isPending && (
          <LoaderCircle className="size-4 animate-spin text-muted-foreground" />
        )}
        {preview.error && (
          <p className="text-sm text-destructive">
            {t("rewind.error", { message: preview.error.message })}
          </p>
        )}
        {data && <PreviewBody preview={data} folder={folder} />}
        {failed.length > 0 && (
          <div className="flex items-start gap-2 text-sm text-destructive">
            <TriangleAlert className="mt-0.5 size-4 shrink-0" />
            <div className="min-w-0">
              <p>{t("rewind.failed")}</p>
              <ul className="mt-1 font-mono text-xs break-all">
                {failed.map((path) => (
                  <li key={path}>{shortPath(path, folder)}</li>
                ))}
              </ul>
            </div>
          </div>
        )}
        {rewind.error && (
          <p className="text-sm text-destructive">
            {t("rewind.error", { message: rewind.error.message })}
          </p>
        )}
        <DialogFooter className="flex-wrap gap-2">
          <Button variant="ghost" onClick={onClose}>
            {t("rewind.cancel")}
          </Button>
          {data && data.files.length > 0 && (
            <Button
              variant="outline"
              disabled={rewind.isPending}
              onClick={() => rewind.mutate("files")}
            >
              {t("rewind.filesOnly")}
            </Button>
          )}
          <Button
            variant={data && data.files.length > 0 ? "outline" : "default"}
            disabled={!data || rewind.isPending}
            onClick={() => rewind.mutate("conversation")}
          >
            {t("rewind.conversation")}
          </Button>
          {data && data.files.length > 0 && (
            <Button disabled={rewind.isPending} onClick={() => rewind.mutate("all")}>
              {t("rewind.all")}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PreviewBody({ preview, folder }: { preview: RewindPreview; folder: string | undefined }) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-2 text-sm">
      {preview.files.length > 0 ? (
        <div>
          <p>{t("rewind.files", { count: preview.files.length })}</p>
          <ul className="mt-1 flex max-h-48 flex-col gap-0.5 overflow-y-auto">
            {preview.files.map((file) => (
              <li key={file.path} className="flex items-baseline justify-between gap-3">
                <span className="truncate font-mono text-xs" title={file.path}>
                  {shortPath(file.path, folder)}
                </span>
                <span
                  className={
                    file.change === "too-large"
                      ? "shrink-0 text-xs text-destructive"
                      : "shrink-0 text-xs text-muted-foreground"
                  }
                >
                  {t(`rewind.change.${file.change}`)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="text-muted-foreground">{t("rewind.noFiles")}</p>
      )}
      {preview.eplanChanges && (
        <p className="flex items-start gap-2">
          <TriangleAlert className="mt-0.5 size-4 shrink-0 text-destructive" />
          <span>
            {t("rewind.eplan")}
            {preview.backups.map((path) => (
              <span key={path} className="block text-xs text-muted-foreground break-all">
                {t("rewind.backup", { path })}
              </span>
            ))}
          </span>
        </p>
      )}
      {preview.commands && (
        <p className="flex items-start gap-2">
          <TriangleAlert className="mt-0.5 size-4 shrink-0 text-destructive" />
          {t("rewind.commands")}
        </p>
      )}
    </div>
  );
}
