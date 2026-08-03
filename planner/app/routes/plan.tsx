import {
  useActionMutation,
  useActionQuery,
} from "@agent-native/core/client/hooks";
import { IconPlus } from "@tabler/icons-react";
import { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";

import { InlineComposer } from "@/components/plan/inline-composer";
import { NodeRow } from "@/components/plan/node-row";
import type { PlanNodeView } from "@/components/plan/types";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

export function meta() {
  return [{ title: "Plan" }];
}

interface PlanResult {
  nodes: PlanNodeView[];
}

const SKELETON_WIDTHS = ["w-3/5", "w-2/5", "w-1/3"];

export default function PlanRoute() {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [addingVision, setAddingVision] = useState(false);
  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set());

  const plan = useActionQuery<PlanResult>("list-plan", {
    includeArchived: false,
  });

  const markPending = useCallback((id: string, pending: boolean) => {
    setPendingIds((current) => {
      const next = new Set(current);
      if (pending) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);

  // useActionMutation already invalidates every ["action"] query on success,
  // so these only need to own error reporting and per-row pending state.
  const updateNode = useActionMutation("update-node", {
    onError: (error: Error) => toast.error(error.message),
  });

  const createNode = useActionMutation("create-node", {
    onError: (error: Error) => toast.error(error.message),
  });

  const handlePatch = useCallback(
    (id: string, patch: Record<string, unknown>) => {
      markPending(id, true);
      updateNode.mutate(
        { id, ...patch },
        { onSettled: () => markPending(id, false) },
      );
    },
    [markPending, updateNode],
  );

  const handleCreateChild = useCallback(
    (parentId: string, tier: string, title: string) => {
      createNode.mutate({ parentId, tier, title });
    },
    [createNode],
  );

  const nodes = useMemo(() => plan.data?.nodes ?? [], [plan.data]);
  const primary = nodes[0];
  const isEmpty = !plan.isLoading && !plan.isError && nodes.length === 0;

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-3xl px-6 pb-32 pt-12 sm:px-8">
        <header className="mb-10">
          <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
            Cascade
          </p>
          <h1 className="font-display mt-2 text-pretty text-[28px] font-semibold leading-[1.2] tracking-[-0.01em] text-foreground sm:text-[34px]">
            {primary ? primary.title : "Your plan"}
          </h1>
          {primary?.detail && (
            <p className="mt-3 max-w-prose text-pretty text-sm leading-7 text-muted-foreground">
              {primary.detail}
            </p>
          )}
        </header>

        {plan.isLoading && <PlanSkeleton />}

        {plan.isError && (
          <p className="text-sm text-destructive">
            Could not load your plan. {(plan.error as Error)?.message}
          </p>
        )}

        {isEmpty && !addingVision && (
          <EmptyState onStart={() => setAddingVision(true)} />
        )}

        {primary && (
          <div className="-ml-1">
            {/* The first vision is the page title, so its children are the
                outline's top level — repeating it as a row would be noise. */}
            {primary.children.map((child) => (
              <NodeRow
                key={child.id}
                node={child}
                depth={0}
                selectedId={selectedId}
                onSelect={setSelectedId}
                onPatch={handlePatch}
                onCreateChild={handleCreateChild}
                pendingIds={pendingIds}
              />
            ))}

            {/* A second vision is unusual but legal; show it rather than
                silently hiding a subtree the user created. */}
            {nodes.slice(1).map((node) => (
              <NodeRow
                key={node.id}
                node={node}
                depth={0}
                selectedId={selectedId}
                onSelect={setSelectedId}
                onPatch={handlePatch}
                onCreateChild={handleCreateChild}
                pendingIds={pendingIds}
              />
            ))}

            <AddYearlyRow visionId={primary.id} onCreate={handleCreateChild} />
          </div>
        )}

        {addingVision && (
          <InlineComposer
            placeholder="What life are you building? — one sentence"
            onCommit={(title) =>
              createNode.mutate(
                { tier: "vision", title },
                { onSuccess: () => setAddingVision(false) },
              )
            }
            onCancel={() => setAddingVision(false)}
            className="text-base"
          />
        )}
      </div>
    </div>
  );
}

function AddYearlyRow({
  visionId,
  onCreate,
}: {
  visionId: string;
  onCreate: (parentId: string, tier: string, title: string) => void;
}) {
  const [adding, setAdding] = useState(false);

  if (adding) {
    return (
      <div className="py-1.5 pl-[26px]">
        <InlineComposer
          placeholder="New yearly goal — be specific"
          onCommit={(title) => onCreate(visionId, "yearly", title)}
          onCancel={() => setAdding(false)}
        />
      </div>
    );
  }

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      onClick={() => setAdding(true)}
      className="mt-1 h-8 gap-1.5 pl-1.5 text-muted-foreground hover:text-foreground"
    >
      <IconPlus className="size-3.5" />
      Add yearly goal
    </Button>
  );
}

function EmptyState({ onStart }: { onStart: () => void }) {
  return (
    <div className="max-w-md">
      <p className="text-sm leading-7 text-muted-foreground">
        Everything here hangs off a vision. Write one sentence about the life
        you&rsquo;re building — you can sharpen it later, and the agent will
        help.
      </p>
      <Button type="button" onClick={onStart} className="mt-5">
        Write your vision
      </Button>
    </div>
  );
}

function PlanSkeleton() {
  return (
    <div className="space-y-3" aria-hidden="true">
      {SKELETON_WIDTHS.map((width) => (
        <div key={width} className="flex items-center gap-2.5">
          <Skeleton className="size-5 shrink-0 rounded-full" />
          <Skeleton className={`h-4 ${width}`} />
        </div>
      ))}
    </div>
  );
}
