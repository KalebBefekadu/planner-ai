import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { captureTranscript, requireUserEmail } from "../server/planner/store.js";

export default defineAction({
  description:
    "Save a raw brain dump verbatim. Do not summarize, tidy, or restructure the text before saving — the analyzer reads the original words later. Capture first, interpret second.",
  schema: z.object({
    body: z.string().min(1).describe("The dump, exactly as spoken or typed."),
    source: z
      .enum(["voice", "text"])
      .default("voice")
      .describe("How the dump was captured."),
    nodeId: z
      .string()
      .optional()
      .describe("Optional id of the plan node this dump is about."),
    capturedAt: z
      .string()
      .optional()
      .describe("ISO timestamp. Defaults to now — set it for backdated entries."),
  }),
  run: async (args, ctx) => {
    const ownerEmail = requireUserEmail(ctx?.userEmail);
    return captureTranscript({ ownerEmail, ...args });
  },
});
