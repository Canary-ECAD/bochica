import { File, Sparkles, type LucideIcon } from "lucide-react";
import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

export interface MenuItem {
  key: string;
  icon: LucideIcon;
  label: string;
  description?: string;
}

export const fileIcon = File;
export const skillIcon = Sparkles;

interface ComposerMenuProps {
  items: MenuItem[];
  active: number;
  onHover(index: number): void;
  onPick(index: number): void;
  /** Shown when there are no items. */
  empty: string;
}

/** The `/` and `@` suggestions, above the composer. The textarea keeps the focus. */
export function ComposerMenu({ items, active, onHover, onPick, empty }: ComposerMenuProps) {
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => {
    list.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  return (
    <div
      ref={list}
      role="listbox"
      className="absolute inset-x-0 bottom-full z-20 mb-2 max-h-72 overflow-y-auto rounded-lg border bg-popover p-1 text-popover-foreground shadow-md"
    >
      {items.length === 0 && <p className="p-2 text-sm text-muted-foreground">{empty}</p>}
      {items.map((item, index) => {
        const Icon = item.icon;
        return (
          <div
            key={item.key}
            role="option"
            data-index={index}
            aria-selected={index === active}
            onMouseEnter={() => onHover(index)}
            // mousedown, not click: the textarea must not lose the focus first.
            onMouseDown={(event) => {
              event.preventDefault();
              onPick(index);
            }}
            className={cn(
              "flex cursor-pointer items-start gap-3 rounded-md px-2 py-1.5",
              index === active && "bg-accent text-accent-foreground",
            )}
          >
            <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1">
              <span className="block truncate font-mono text-sm">{item.label}</span>
              {item.description && (
                <span className="block truncate text-xs text-muted-foreground">
                  {item.description}
                </span>
              )}
            </span>
          </div>
        );
      })}
    </div>
  );
}
