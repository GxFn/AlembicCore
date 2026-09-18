# Lint Debt Ownership

## noExplicitAny override debt (CO4 baseline, 2026-06-12)

`biome.json` keeps `suspicious/noExplicitAny: off` overrides only for the
directories below. The override list is shrink-only: removing a directory
requires fixing its violations type-safely with zero behavior change; adding
a directory back requires a controller decision.

Measured violation counts at CO4 start (method: biome lint per directory with
the override removed; raw output in the CO4 state-root evidence):

| Directory | Violations | Status |
| --- | ---: | --- |
| `src/infrastructure/vector/**` | 1 | REMOVED in CO4 (fixed: ASTChunker LANG_ID_MAP cast → `Record<string, string>`) |
| `src/core/discovery/**` | 13 | Owned. Owner: AlembicCore window. Trigger: first dedicated discovery-area refactor wave (CKG1 names this area), fix alongside. |
| `src/core/ast/**` | 918 | Owned. Owner: AlembicCore window. Bulk debt in generated/parser-adjacent code; not economical to fix piecemeal. Trigger: post-CKG AST-area restructuring, or a dedicated typed-AST adoption demand; revisit at each CO-style audit. |

The base severity for `noExplicitAny` everywhere else is `warn` (see
`biome.json`); `test/**` keeps its own relaxation for mock ergonomics.

The retired `src/service/panorama/**` override was removed during the 2026-09-17 review; the directory no longer exists.
