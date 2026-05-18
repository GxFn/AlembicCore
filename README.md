# AlembicCore

AlembicCore is the shared headless core for Alembic runtimes.

This repository contains the shared, headless, deterministic core used by the
Alembic runtime family. It is the first package that downstream release staging
depends on: `@alembic/agent` and the main `alembic-ai` package should consume
the published `@alembic/core` registry version when preparing release manifests.

## Current Scope

- Public package entrypoints and boundary policy for `@alembic/core`.
- SQLite / Drizzle repositories, migrations, workspace settings, and persistence contracts.
- Search, vector, Guard, AST/grammar, project intelligence, and host-agent workflow contracts.
- Release readiness checks for package contents, `dist` exports, source commit evidence, and sibling-free dependencies.

## Repository Role

`AlembicCore` must not depend on the local full Alembic app or the Codex plugin
repository. The dependency direction is:

```text
AlembicCore
  ^
  |- AlembicAgent
  |- Alembic
  |- AlembicPlugin portable runtime snapshot
```

Daily local development in the workspace can still use sibling source links in
downstream repositories. Published release manifests must use the registry
package instead.

## Release

Core releases are guarded by:

```text
npm run check
npm run build
npm run smoke:public-api
npm run release:check
```

The release workflow supports a manual dry-run staging path and publishes only
from a `v<package.version>` tag with npm provenance enabled. See
`RELEASE-PLAYBOOK.md` for the full release sequence and prerequisites.
