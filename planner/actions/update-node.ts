import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { requireUserEmail, updateNode } from "../server/planner/store.js";

export default defineAction({
  description:
    "Patch a plan node. Pass only the fields that change. Use this to mark progress, sharpen a vague title, re-parent a node, or archive one.",
  schema: z.object({
    id: z.string().min(1).describe("Id of the node to update."),
    title: z.string().min(1).optional(),
    detail: z.string().nullable().optional(),
    status: z
      .enum(["pending", "in_progress", "done", "dropped"])
      .optional()
      .describe("Progress state of the node."),
    parentId: z
      .string()
      .nullable()
      .optional()
      .describe(
        "Move the node under a different parent. Null makes it a root.",
      ),
    horizonStart: z.string().nullable().optional(),
    horizonEnd: z.string().nullable().optional(),
    sortOrder: z.number().int().optional(),
    archived: z
      .boolean()
      .optional()
      .describe("Archive (soft-delete) or restore the node."),
  }),
  run: async ({ id, ...patch }, ctx) => {
    const ownerEmail = requireUserEmail(ctx?.userEmail);
    return updateNode({ ownerEmail, id, patch });
  },
});
