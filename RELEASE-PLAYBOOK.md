# AlembicCore Release Playbook

`@alembic/core` is the first registry package in the Alembic release chain.
Downstream staging manifests for `@alembic/agent` and the main `alembic-ai`
package depend on the Core version published here.

## Ownership

- Package name: `@alembic/core`
- Registry: npm public registry
- Tag format: `v<package.version>`, for example `v0.1.0`
- Source commit evidence: the release workflow records `GITHUB_SHA` and the
  `npm run release:check` source commit output.
- Package contents evidence: the release workflow uploads the
  `npm pack --dry-run --json` result as `alembic-core-pack-dry-run`.

## Preconditions

Before a real publish:

1. `package.json` has the intended `version`.
2. The release commit is on `main` and the working tree is clean.
3. GitHub Actions has an npm automation token in `NPM_TOKEN`.
4. The repository workflow permission allows OIDC so `npm publish --provenance`
   can attach provenance.
5. The npm organization/package permission allows publishing `@alembic/core`
   with `--access public`.
6. Downstream release staging has not replaced local development manifests; only
   staging manifests should consume the registry Core version.

## Dry-Run Staging

Use the `Core Release` workflow with `workflow_dispatch`.

The manual path does not publish. It runs:

```text
npm ci
npm run check
npm run build
npm run smoke:public-api
npm run release:check
npm pack --dry-run --json
```

The workflow summary records package name, version, source commit, tarball name,
entry count, unpacked size, and integrity. The pack preview artifact is the
handoff evidence for downstream staging windows.

## Publish

1. Confirm the dry-run workflow passed on the intended commit.
2. Create a tag matching the package version:

```text
git tag -a v<package.version> -m "Release @alembic/core v<package.version>"
git push origin v<package.version>
```

3. The `Core Release` workflow checks that the tag equals `v${package.version}`.
4. The workflow repeats the full check/build/smoke/release readiness sequence.
5. The workflow publishes with:

```text
npm publish --access public --provenance
```

## Failure Handling

- If `release:check` reports `dirty-working-tree`, commit, stash, or revert local
  changes before staging the release. The readiness check is release-oriented and
  must fail on uncommitted package state.
- If `release:check` fails for package metadata, `dist` output, exports, or package
  `files`, fix the package contents before publishing.
- If tag validation fails, delete the incorrect tag and create a tag matching
  `package.json` version.
- If npm publish fails because of auth or provenance, fix the GitHub secret,
  repository OIDC permission, or npm package permission; do not bypass
  `release:check`.
- If downstream staging needs a Core version that is not yet published, keep
  downstream hard gates enabled rather than publishing a root dev manifest with
  `file:../...` dependencies.

## Downstream Order

1. Publish or dry-run stage `@alembic/core`.
2. Stage `@alembic/agent` with registry `@alembic/core`.
3. Stage the main `alembic-ai` package with registry `@alembic/core` and
   `@alembic/agent`.
4. Keep `AlembicPlugin` on Codex plugin artifacts and portable runtime snapshots;
   its embedded runtime may continue using `file:vendor/AlembicCore` with source
   metadata.
