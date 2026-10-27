import { Folder, FolderOpen } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";

/** "C:\Users\me\Documents\Bochica" → "Bochica". */
function folderName(path: string): string {
  return (
    path
      .replace(/[\\/]+$/, "")
      .split(/[\\/]/)
      .at(-1) || path
  );
}

/**
 * The session's working folder. Before the first message it opens the system folder picker;
 * afterwards it only shows the folder, because a session never moves.
 */
export function FolderPicker({ folder, onPick }: { folder: string; onPick?: () => void }) {
  const { t } = useTranslation();
  if (!onPick) {
    return (
      <span
        className="flex min-w-0 items-center gap-1.5 px-2 text-xs text-muted-foreground"
        title={t("folder.fixed", { folder })}
      >
        <Folder className="size-3.5 shrink-0" />
        <span className="truncate">{folderName(folder)}</span>
      </span>
    );
  }
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className="min-w-0 text-muted-foreground"
      title={t("folder.choose", { folder })}
      aria-label={t("folder.choose", { folder })}
      onClick={onPick}
    >
      <FolderOpen />
      <span className="truncate">{folderName(folder)}</span>
    </Button>
  );
}
