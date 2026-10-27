import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { Ellipsis, Pencil, Trash2 } from "lucide-react";
import { DropdownMenu } from "radix-ui";
import { useState } from "react";
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
import { deleteSession, renameSession } from "@/state/sessions";

const menuItem =
  "flex cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none select-none data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground [&_svg]:size-4";

/** One session in the sidebar: a link, plus a "…" menu to rename or delete it. */
export function SessionRow({ id, title }: { id: string; title: string }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(title);
  const [confirming, setConfirming] = useState(false);
  const label = title || t("nav.untitled");

  const finishRename = (): void => {
    setEditing(false);
    const next = draft.trim();
    if (next && next !== title) void renameSession(id, next);
  };

  if (editing) {
    return (
      <input
        autoFocus
        value={draft}
        maxLength={120}
        aria-label={t("sessions.renameLabel")}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={finishRename}
        onKeyDown={(event) => {
          if (event.key === "Enter") finishRename();
          if (event.key === "Escape") {
            setDraft(title);
            setEditing(false);
          }
        }}
        className="rounded-md border bg-background px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-ring"
      />
    );
  }

  return (
    <div className="group relative">
      <Link
        to="/session/$sessionId"
        params={{ sessionId: id }}
        className="block truncate rounded-md px-3 py-1.5 pr-8 text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground [&.active]:bg-accent [&.active]:text-accent-foreground"
      >
        {label}
      </Link>
      <DropdownMenu.Root>
        <DropdownMenu.Trigger
          aria-label={t("sessions.actions", { title: label })}
          className="absolute top-1/2 right-1 -translate-y-1/2 rounded-md p-1 text-muted-foreground opacity-0 group-hover:opacity-100 hover:bg-background hover:text-foreground focus-visible:opacity-100 data-[state=open]:opacity-100"
        >
          <Ellipsis className="size-4" />
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content
            align="start"
            sideOffset={4}
            className="z-50 min-w-36 rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
          >
            <DropdownMenu.Item
              className={menuItem}
              onSelect={() => {
                setDraft(title);
                setEditing(true);
              }}
            >
              <Pencil />
              {t("sessions.rename")}
            </DropdownMenu.Item>
            <DropdownMenu.Item
              className={`${menuItem} text-destructive data-[highlighted]:text-destructive`}
              onSelect={() => setConfirming(true)}
            >
              <Trash2 />
              {t("sessions.delete")}
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>

      <Dialog open={confirming} onOpenChange={setConfirming}>
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>{t("sessions.deleteTitle")}</DialogTitle>
            <DialogDescription>
              {t("sessions.deleteDescription", { title: label })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirming(false)}>
              {t("sessions.cancel")}
            </Button>
            <Button
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={() => {
                setConfirming(false);
                void deleteSession(id);
                if (pathname.endsWith(`/session/${id}`)) void navigate({ to: "/" });
              }}
            >
              {t("sessions.delete")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
