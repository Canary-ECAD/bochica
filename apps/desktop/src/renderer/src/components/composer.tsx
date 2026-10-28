import { type ChatMode, type ContextUsage, mentionFor, parseSlashCommand } from "@bochica/shared";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import {
  ArrowUp,
  FoldVertical,
  LoaderCircle,
  MessageCircleQuestion,
  PenTool,
  Settings,
  Square,
  SquarePen,
  Wrench,
} from "lucide-react";
import { useLayoutEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ComposerMenu, fileIcon, type MenuItem, skillIcon } from "@/components/composer-menu";
import { ContextMeter } from "@/components/context-meter";
import { FolderPicker } from "@/components/folder-picker";
import { ModelPicker } from "@/components/model-picker";
import { ModePicker } from "@/components/mode-picker";
import { PermissionPicker } from "@/components/permission-picker";
import { skillsKey } from "@/components/skills-settings";
import { Button } from "@/components/ui/button";
import { activeTrigger, complete, matchByName } from "@/lib/composer-trigger";
import { useMode } from "@/state/mode";
import { useModelChoice } from "@/state/model-choice";
import type { PermissionMode } from "@/state/permission";
import type { ModelChoice } from "@/state/sessions";

/**
 * The app's own commands. All run in the app except /compact, which is sent: main summarises
 * the conversation. Their names are reserved for skills (APP_COMMANDS in main/skills.ts).
 */
const appCommands = [
  { name: "new", icon: SquarePen },
  { name: "consult", icon: MessageCircleQuestion },
  { name: "tasks", icon: Wrench },
  { name: "draw", icon: PenTool },
  { name: "compact", icon: FoldVertical },
  { name: "settings", icon: Settings },
] as const;
type AppCommand = Exclude<(typeof appCommands)[number]["name"], "compact">;

const isAppCommand = (name: string): name is AppCommand =>
  name !== "compact" && appCommands.some((command) => command.name === name);

interface ComposerProps {
  onSend(text: string, choice: ModelChoice): void;
  /** Present while a turn is streaming: the send button becomes a stop button. */
  onStop?: (() => void) | undefined;
  autoFocus?: boolean;
  /** The session's working folder; with `onPickFolder` the user can still change it. */
  folder?: string | undefined;
  onPickFolder?: (() => void) | undefined;
  /** How full the model's context was after the last answer, in a session. */
  context?: ContextUsage | undefined;
  /** How much Bochica asks: Ask, Plan or Auto. */
  permission: PermissionMode;
  onPermission(mode: PermissionMode): void;
  /** Text the box starts with, e.g. a message given back by a rewind. */
  initialText?: string | undefined;
}

export function Composer({
  onSend,
  onStop,
  autoFocus = false,
  folder,
  onPickFolder,
  context,
  permission,
  onPermission,
  initialText = "",
}: ComposerProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const setMode = useMode((state) => state.setMode);
  const [draft, setDraft] = useState(initialText);
  const [cursor, setCursor] = useState(initialText.length);
  const [active, setActive] = useState(0);
  /** Esc hides the menu until the text changes. */
  const [dismissed, setDismissed] = useState(false);
  const textarea = useRef<HTMLTextAreaElement>(null);
  /** Where the cursor goes once an inserted item is on screen. */
  const [pendingCursor, setPendingCursor] = useState<number | null>(null);
  const models = useModelChoice();
  const { choice } = models;

  const trigger = dismissed ? null : activeTrigger(draft, cursor);
  const skills = useQuery({ queryKey: skillsKey, queryFn: () => window.bochica.skills.list() });
  const query = trigger?.kind === "mention" ? trigger.query : "";
  const files = useQuery({
    queryKey: ["files", folder, query],
    queryFn: () => window.bochica.files.search({ folder: folder ?? "", query }),
    enabled: trigger?.kind === "mention" && Boolean(folder),
    placeholderData: keepPreviousData,
  });

  const menuItems = (): MenuItem[] => {
    if (trigger?.kind === "command") {
      const commands = appCommands.map((c) => ({ ...c, description: t(`commands.${c.name}`) }));
      const usable = (skills.data ?? [])
        .filter(
          (s) => s.status === "ok" && s.enabled && !appCommands.some((c) => c.name === s.name),
        )
        .map((s) => ({ name: s.name, icon: skillIcon, description: s.description }));
      return matchByName([...commands, ...usable], trigger.query).map((item) => ({
        key: `/${item.name}`,
        icon: item.icon,
        label: `/${item.name}`,
        description: item.description,
      }));
    }
    if (trigger?.kind === "mention") {
      return (files.data ?? []).map((path) => ({ key: path, icon: fileIcon, label: path }));
    }
    return [];
  };
  const items = menuItems();

  useLayoutEffect(() => {
    if (pendingCursor === null || !textarea.current) return;
    textarea.current.setSelectionRange(pendingCursor, pendingCursor);
    setPendingCursor(null);
  }, [pendingCursor]);

  const edit = (text: string, at: number): void => {
    setDraft(text);
    setCursor(at);
    setActive(0);
    setDismissed(false);
  };

  const runCommand = (name: AppCommand): void => {
    edit("", 0);
    if (name === "new") void navigate({ to: "/" });
    else if (name === "settings") void navigate({ to: "/settings" });
    else setMode(name satisfies ChatMode);
  };

  const pick = (index: number): void => {
    const item = items[index];
    if (!trigger || !item) return;
    if (trigger.kind === "command") {
      const name = item.label.slice(1);
      if (isAppCommand(name)) {
        runCommand(name);
        return;
      }
      if (name === "compact") {
        if (choice && !onStop) onSend("/compact", choice);
        edit("", 0);
        return;
      }
    }
    const insert = trigger.kind === "command" ? item.label : mentionFor(item.label);
    const next = complete(draft, trigger, insert);
    edit(next.text, next.cursor);
    setPendingCursor(next.cursor);
  };

  const canSend = draft.trim().length > 0 && choice !== null && !onStop;
  const submit = (): void => {
    const command = parseSlashCommand(draft);
    if (command && !command.args && isAppCommand(command.name)) {
      runCommand(command.name);
      return;
    }
    if (!canSend) return;
    onSend(draft.trim(), choice);
    edit("", 0);
  };

  const menuOpen = trigger !== null && (items.length > 0 || trigger.kind === "mention");

  return (
    <form
      className="relative rounded-xl border bg-card p-3 shadow-sm focus-within:ring-2 focus-within:ring-ring"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      {menuOpen && (
        <ComposerMenu
          items={items}
          active={Math.min(active, Math.max(items.length - 1, 0))}
          onHover={setActive}
          onPick={pick}
          empty={folder ? t("composer.noFiles") : t("composer.noFolder")}
        />
      )}
      {/* field-sizing grows the box with the text; max-h then makes it scroll. */}
      <textarea
        ref={textarea}
        value={draft}
        autoFocus={autoFocus}
        onChange={(event) => edit(event.target.value, event.target.selectionStart)}
        onSelect={(event) => setCursor(event.currentTarget.selectionStart)}
        onBlur={() => setDismissed(true)}
        onFocus={() => setDismissed(false)}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing) return;
          if (menuOpen && items.length > 0) {
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault();
              const step = event.key === "ArrowDown" ? 1 : -1;
              setActive(
                (i) => (Math.min(i, items.length - 1) + step + items.length) % items.length,
              );
              return;
            }
            if ((event.key === "Enter" && !event.shiftKey) || event.key === "Tab") {
              event.preventDefault();
              pick(Math.min(active, items.length - 1));
              return;
            }
          }
          if (menuOpen && event.key === "Escape") {
            event.preventDefault();
            setDismissed(true);
            return;
          }
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            submit();
          }
        }}
        placeholder={t("session.placeholder")}
        className="field-sizing-content max-h-60 min-h-12 w-full resize-none bg-transparent px-1 text-sm leading-6 outline-none placeholder:text-muted-foreground"
      />
      <div className="mt-1 flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1">
          <ModePicker />
          <PermissionPicker mode={permission} onChange={onPermission} />
          {folder && (
            <FolderPicker folder={folder} {...(onPickFolder ? { onPick: onPickFolder } : {})} />
          )}
          {context && <ContextMeter usage={context} />}
          {models.groups.length > 0 ? (
            <ModelPicker state={models} />
          ) : models.loading ? (
            <span className="flex items-center gap-2 px-2 text-xs text-muted-foreground">
              <LoaderCircle className="size-3 animate-spin" />
              {t("chat.loadingModels")}
            </span>
          ) : (
            <Link to="/settings" className="px-2 text-xs text-primary hover:underline">
              {t("chat.addProvider")}
            </Link>
          )}
        </div>
        {onStop ? (
          <Button type="button" size="icon" onClick={onStop} aria-label={t("chat.stop")}>
            <Square className="fill-current" />
          </Button>
        ) : (
          <Button type="submit" size="icon" disabled={!canSend} aria-label={t("session.send")}>
            <ArrowUp />
          </Button>
        )}
      </div>
    </form>
  );
}
