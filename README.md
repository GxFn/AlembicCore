# AlembicCore

AlembicCore is the shared headless core for Alembic runtimes.

This repository is intentionally small at the first split point. It holds the
stable contracts that both outer repositories can depend on while fuller
runtime, knowledge, guard, and workspace implementations are migrated in
incrementally.

## Current Scope

- `@alembic/core` package metadata and TypeScript build setup.
- Shared folder-name contract extracted from the current Alembic runtime.
- Minimal runtime factory contract for host repositories.

## Repository Role

`AlembicCore` must not depend on the local full Alembic app or the Codex plugin
repository. The dependency direction is:

```text
AlembicCore
  ^
  |- Alembic
  |- AlembicPlugin
```

Future migrations should move real shared implementations here only when both
outer repositories need the behavior.
