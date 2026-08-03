import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { createNode, requireUserEmail } from "../server/planner/store.js";

export default defineAction({
  description:
    "Add a node to the planning cascade. Omit parentId to start a new vision; otherwise pass the id of the node one tier up. Prefer specific, measurable titles — vague goals are the thing this app exists to prevent.",
  schema: z.object({
    tier: z
      .string()
      .min(1)
      .describe(
        "Cascade level: vision, yearly, quarterly, monthly, or weekly. Custom tiers are allowed.",
      ),
    title: z.string().min(1).describe("Short, specific statement of the goal."),
    detail: z.string().optional().describe("Long-form reasoning or context."),
    parentId: z
      .string()
      .optional()
      .describe("Id of the parent node. Omit for a root-level vision."),
    horizonStart: z.string().optional().describe("ISO date the node starts."),
    horizonEnd: z.string().optional().describe("ISO date the node is due."),
  }),
  run: async (args, ctx) => {
    const ownerEmail = requireUserEmail(ctx?.userEmail);
    return createNode({ ownerEmail, ...args });
  },
});
