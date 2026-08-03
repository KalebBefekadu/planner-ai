import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { listPlan, requireUserEmail } from "../server/planner/store.js";

export default defineAction({
  description:
    "Read the user's whole planning cascade as a nested tree. Each node has a tier (vision, yearly, quarterly, monthly, weekly), a status, an optional horizon, and its children. Call this before reasoning about goals or progress.",
  schema: z.object({
    includeArchived: z
      .boolean()
      .default(false)
      .describe("Include archived nodes in the tree."),
  }),
  http: { method: "GET" },
  readOnly: true,
  run: async (args, ctx) => {
    const ownerEmail = requireUserEmail(ctx?.userEmail);
    return { nodes: await listPlan({ ownerEmail, includeArchived: args.includeArchived }) };
  },
});
