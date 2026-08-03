import {
  IconArchive,
  IconChevronRight,
  IconCircleMinus,
  IconDotsVertical,
  IconPlus,
} from "@tabler/icons-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

import { InlineComposer } from "./inline-composer";
import { StatusControl } from "./status-control";
import {
  childTier,
  nextStatus,
  subtreeProgress,
  type PlanNodeView,
} from "./types";

export interface NodeRowProps {
  node: PlanNodeView;
  depth: number;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onPatch: (id: string, patch: Record<string, unknown>) => void;
  onCreateChild: (parentId: string, tier: string, title: string) => void;
  pendingIds: Set<string>;
}

function formatHorizon(node: PlanNodeView): string | null {
  if (!node.horizonEnd) return null;
  const date = new Date(node.horizonEnd);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString(undefined, {
    month: "short",
    year: "numeric",
  });
}

export function NodeRow({
  node,
  depth,
  selectedId,
  onSelect,
  onPatch,
  onCreateChild,
  pendingIds,
}: NodeRowProps) {
  // Top two levels open by default: the shape of the year should be visible on
  // arrival, while weekly detail stays folded until asked for.
  const [open, setOpen] = useState(depth < 2);
  const [adding, setAdding] = useState(false);

  const nextTier = childTier(node.tier);
  const progress = subtreeProgress(node);
  const horizon = formatHorizon(node);
  const isPending = pendingIds.has(node.id);
  const isSelected = selectedId === node.id;
  const hasChildren = node.children.length > 0;
  const isDone = node.status === "done";
  const isDropped = node.status === "dropped";

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <div
        className={cn(
          "group/row relative flex items-start gap-2.5 rounded-md py-1.5 pr-1 transition-colors",
          "hover:bg-muted/40",
          isSelected && "bg-muted/60",
          isPending && "opacity-60",
        )}
        onClick={() => onSelect(node.id)}
      >
        <div className="flex items-center gap-1 pt-0.5">
          <CollapsibleTrigger asChild>
            <button
              type="button"
              aria-label={open ? "Collapse" : "Expand"}
              onClick={(event) => event.stopPropagation()}
              className={cn(
                "grid size-4 shrink-0 place-items-center rounded text-muted-foreground",
                "transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                hasChildren
                  ? "opacity-60 hover:opacity-100"
                  : "pointer-events-none opacity-0",
              )}
            >
              <IconChevronRight
                className={cn(
                  "size-3.5 transition-transform duration-200 ease-[var(--ease-collapse)]",
                  open && "rotate-90",
                )}
              />
            </button>
          </CollapsibleTrigger>

          <div onClick={(event) => event.stopPropagation()}>
            <StatusControl
              status={node.status}
              disabled={isPending}
              onAdvance={() =>
                onPatch(node.id, { status: nextStatus(node.status) })
              }
            />
          </div>
        </div>

        <div className="min-w-0 flex-1 pt-px">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <span
              className={cn(
                "text-sm leading-6",
                isDone && "text-muted-foreground line-through decoration-1",
                isDropped &&
                  "text-muted-foreground/70 line-through decoration-1",
              )}
            >
              {node.title}
            </span>
            {horizon && (
              <span className="text-[11px] tabular-nums text-muted-foreground/70">
                {horizon}
              </span>
            )}
          </div>

          {node.detail && open && (
            <p className="mt-1 max-w-prose whitespace-pre-wrap text-[13px] leading-6 text-muted-foreground">
              {node.detail}
            </p>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-0.5 pt-0.5">
          {progress.total > 0 && (
            <span
              className={cn(
                "mr-1 text-[11px] tabular-nums text-muted-foreground/70",
                progress.done === progress.total && "text-primary",
              )}
            >
              {progress.done}/{progress.total}
            </span>
          )}

          {/* Row actions stay invisible until the row is hovered or a control
              inside it takes focus, so a hundred-row cascade reads as text. */}
          <div
            className={cn(
              "flex items-center gap-0.5 opacity-0 transition-opacity",
              "group-hover/row:opacity-100 focus-within:opacity-100",
            )}
            onClick={(event) => event.stopPropagation()}
          >
            {nextTier && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-6 text-muted-foreground"
                    aria-label={`Add ${nextTier} goal`}
                    onClick={() => {
                      setOpen(true);
                      setAdding(true);
                    }}
                  >
                    <IconPlus className="size-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="top">Add {nextTier}</TooltipContent>
              </Tooltip>
            )}

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-6 text-muted-foreground"
                  aria-label={`Options for ${node.title}`}
                >
                  <IconDotsVertical className="size-3.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-44">
                <DropdownMenuGroup>
                  <DropdownMenuItem
                    onSelect={() => onPatch(node.id, { status: "dropped" })}
                    disabled={isDropped}
                  >
                    <IconCircleMinus className="size-4" />
                    Drop goal
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onSelect={() => onPatch(node.id, { archived: true })}
                  >
                    <IconArchive className="size-4" />
                    Archive
                  </DropdownMenuItem>
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </div>

      <CollapsibleContent>
        {/* The hairline is the only structural chrome in the outline: it
            carries depth so the rows themselves need no boxes. */}
        <div className="ml-[9px] border-l border-border/60 pl-4">
          {node.children.map((child) => (
            <NodeRow
              key={child.id}
              node={child}
              depth={depth + 1}
              selectedId={selectedId}
              onSelect={onSelect}
              onPatch={onPatch}
              onCreateChild={onCreateChild}
              pendingIds={pendingIds}
            />
          ))}

          {adding && nextTier && (
            <div className="py-1.5 pl-[26px]">
              <InlineComposer
                placeholder={`New ${nextTier} goal — be specific`}
                onCommit={(title) => onCreateChild(node.id, nextTier, title)}
                onCancel={() => setAdding(false)}
              />
            </div>
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
