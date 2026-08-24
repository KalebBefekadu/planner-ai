---
status: accepted
---

# Ship a PWA before native mobile

The first mobile product is the responsive Next.js web application packaged as an installable Progressive Web App. It supports touch, mobile navigation, browser-based voice Capture, authenticated shared data, and local recovery of unsent Captures.

## Consequences

- Desktop and mobile share one UI, authentication flow, Operation layer, and test suite.
- Native wrappers and separate iOS or Android clients wait for beta evidence that browser limitations block repeated use.
- Push notifications remain outside the first notification scope.
