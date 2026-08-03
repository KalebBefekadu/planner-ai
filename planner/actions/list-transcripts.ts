import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { listTranscripts, requireUserEmail } from "../server/planner/store.js";

export default defineAction({
  description:
    "Read recent brain dumps, newest first. Use unprocessedOnly to fetch just the dumps the coach has not yet reviewed.",
  schema: z.object({
    limit: z.coerce.number().int().min(1).max(100).default(20),
    unprocessedOnly: z
      .boolean()
      .default(false)
      .describe("Only return dumps with no processedAt stamp."),
  }),
  http: { method: "GET" },
  readOnly: true,
  run: async (args, ctx) => {
    const ownerEmail = requireUserEmail(ctx?.userEmail);
    return { transcripts: await listTranscripts({ ownerEmail, ...args }) };
  },
});
