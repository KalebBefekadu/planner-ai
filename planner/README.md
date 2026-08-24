# Agent Native Integration Reference

This directory is an imported Agent Native Chat-template experiment. It is not the Planner AI product, not a production deployment target, and not an authoritative data store.

## Allowed Use

- Inspect Agent Native action, context, approval, Conversation, and UI patterns.
- Run the timeboxed sidecar feasibility spike described by PAI-501 and PAI-509.
- Extract small, reviewed pieces into a new minimal runtime.

Do not build Planner AI product screens here, migrate Supabase domain data into its generic node model, or expose its developer capabilities to production users. Data created in this app is disposable unless explicitly exported for analysis.

## Local Reference Run

The imported version requires Node.js `>=22.22.0` and uses pnpm:

```bash
pnpm install
pnpm dev
```

The target repository toolchain will standardize on Node.js 24 LTS during foundation work. Production requires a separately deployed minimal Agent Native runtime, a separate persistent managed Postgres database for framework state, strict origin controls, and short-lived identity delegation from `web`.

See the [target architecture](../architecture.md), [ADR-0002](../docs/adr/0002-embed-agent-native-in-the-web-product.md), [ADR-0014](../docs/adr/0014-isolate-agent-native-framework-state.md), and [ADR-0022](../docs/adr/0022-stage-agent-extensibility-behind-security-gates.md).
