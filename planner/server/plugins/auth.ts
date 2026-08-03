import { createAuthPlugin } from "@agent-native/core/server";

const rawAppTitle = "Planner";
const appTitle = rawAppTitle === "{" + "{APP_TITLE}}" ? "Chat" : rawAppTitle;

/**
 * Copy for the public sign-in page. This is the first thing anyone sees, so it
 * describes Planner — not the framework it happens to be built on.
 */
export default createAuthPlugin({
  marketing: {
    appName: appTitle,
    tagline:
      "Talk through your week. Planner keeps the structure — from this week's actions up to the life you're building.",
    features: [
      "Dump the week out loud; nothing gets lost and nothing gets summarized away",
      "Every action ladders up through the month, the quarter, the year, the vision",
      "A coach that reads your own words back and tells you where you've drifted",
    ],
  },
});
