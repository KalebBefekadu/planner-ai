import { IconCheck, IconMinus } from "@tabler/icons-react";

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

const LABELS: Record<string, string> = {
  pending: "Not started",
  in_progress: "In progress",
  done: "Done",
  dropped: "Dropped",
};

/**
 * The one control the user touches constantly, so it stays a 20px ring rather
 * than a labelled badge: status is legible at a glance from its fill, and the
 * word only appears on hover.
 */
export function StatusControl({
  status,
  onAdvance,
  disabled,
}: {
  status: string;
  onAdvance: () => void;
  disabled?: boolean;
}) {
  const label = LABELS[status] ?? status;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={onAdvance}
          disabled={disabled}
          aria-label={`Status: ${label}. Click to advance.`}
          className={cn(
            "grid size-5 shrink-0 place-items-center rounded-full border transition-[background-color,border-color,transform] duration-150 ease-[var(--ease-out-strong)]",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
            "disabled:opacity-50",
            !disabled && "hover:scale-110",
            status === "done" &&
              "border-primary bg-primary text-primary-foreground",
            status === "in_progress" && "border-primary bg-primary/15",
            status === "pending" &&
              "border-muted-foreground/35 hover:border-muted-foreground/70",
            status === "dropped" &&
              "border-dashed border-muted-foreground/35 text-muted-foreground",
          )}
        >
          {status === "done" && <IconCheck className="size-3" stroke={3} />}
          {status === "dropped" && <IconMinus className="size-3" stroke={3} />}
          {status === "in_progress" && (
            <span className="size-1.5 rounded-full bg-primary" />
          )}
        </button>
      </TooltipTrigger>
      <TooltipContent side="left">{label}</TooltipContent>
    </Tooltip>
  );
}
