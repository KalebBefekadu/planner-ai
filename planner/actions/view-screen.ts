/**
 * See what the user is currently looking at on screen.
 *
 * Usage:
 *   pnpm action view-screen
 */

import { defineAction } from "@agent-native/core/action";
import { readAppState } from "@agent-native/core/application-state";
import { z } from "zod";

import {
  type PlanNodeTree,
  listPlan,
  requireUserEmail,
} from "../server/planner/store.js";

/**
 * One line per node: enough for the agent to resolve "that goal" or "the
 * second one" against what the user can actually see, without spending the
 * context window on detail bodies and timestamps. `list-plan` stays the way to
 * get full records.
 */
function outline(nodes: PlanNodeTree[], depth = 0): string[] {
  const lines: string[] = [];
  for (const node of nodes) {
    const indent = "  ".repeat(depth);
    lines.push(
      `${indent}- [${node.status}] ${node.tier}: ${node.title} (id: ${node.id})`,
    );
    lines.push(...outline(node.children, depth + 1));
  }
  return lines;
}

export default defineAction({
  description:
    "See what the user is currently looking at on screen. Returns the current navigation state, plus a compact outline of the cascade when the user is on the plan page. Always call this first when the user refers to something indirectly ('that goal', 'the second one').",
  schema: z.object({}),
  http: false,
  readOnly: true,
  run: async (_args, ctx) => {
    const navigation = (await readAppState("navigation")) as {
      view?: string;
    } | null;

    if (!navigation) {
      return "No application state found. Is the app running?";
    }

    const screen: Record<string, unknown> = { navigation };

    if (navigation.view === "plan") {
      const ownerEmail = requireUserEmail(ctx?.userEmail);
      const nodes = await listPlan({ ownerEmail });
      screen.visiblePlan =
        nodes.length > 0
          ? outline(nodes).join("\n")
          : "The plan is empty — the user has not written a vision yet.";
    }

    return screen;
  },
});
