# Releasing

This repo ships two artefacts that are released together:

1. **`@runner-yufeng/ai-image`** on npm — the CLI.
2. **`ai-image-cc-plugin`** Claude Code plugin — consumed via `/plugin marketplace add runner-yufeng/ai-image-cc-plugin`. Tracks the GitHub ref.

Keep the versions in lock-step so users don't get a plugin that calls a CLI version that doesn't exist.

## One-time setup

- `npm login` with an account that owns (or can publish to) the `@runner-yufeng` scope. Scoped packages under `@<your-username>` are free and automatically yours once you have an npm account.
- `npm whoami` should return `runner-yufeng`.
- Make sure you have `bun` on PATH (used by the build script).

## Name conflict: `ai-image` (bare)

The unscoped name `ai-image` is already published to npm (last seen at `0.0.8`, appears unmaintained). We publish under the scoped name `@runner-yufeng/ai-image` to avoid this. If you ever reclaim the bare name via `npm support`, flip the `name` field in `package.json` and republish.

## Release checklist

1. **Bump versions in three places** — keep them identical:
   - `package.json` → `version`
   - `.claude-plugin/marketplace.json` → `metadata.version` and the entry under `plugins[0].version`
   - `plugins/ai-image/.claude-plugin/plugin.json` → `version`

2. **Refresh the lockfile:**
   ```bash
   bun install
   ```

3. **Build and smoke-test the CLI locally:**
   ```bash
   bun run build
   node dist/cli.js --help
   ```

4. **Commit and tag:**
   ```bash
   git add package.json bun.lock .claude-plugin/marketplace.json plugins/ai-image/.claude-plugin/plugin.json
   git commit -m "release: vX.Y.Z"
   git tag vX.Y.Z
   git push && git push --tags
   ```

5. **Publish to npm:**
   ```bash
   npm publish
   ```
   `prepublishOnly` runs `bun run build`, and `files` plus `publishConfig.access=public` are already configured, so this is the only command you need.

6. **Verify the publish:**
   ```bash
   npm view @runner-yufeng/ai-image version
   bunx @runner-yufeng/ai-image --help
   ```

7. **Confirm the plugin picks up the new CLI:**
   - In a clean Claude Code session: `/plugin marketplace update runner-yufeng/ai-image-cc-plugin`
   - Re-install the plugin, ask Claude to generate a test image, watch that it shells out to `bunx @runner-yufeng/ai-image`.

## What gets published

Only the files listed under `files` in `package.json` ship to npm:

- `dist/` — the bundled CLI (`dist/cli.js`, shebang `#!/usr/bin/env node`)
- `README.md`
- `LICENSE`

Runtime deps (`ai`, `@ai-sdk/*`) are marked `external` in the build so they install from npm, not from the bundle.

## Rollback

npm does not allow true deletion after 72 hours, so rollback = publish a fixed patch version. If something is truly broken in the first hours after release, `npm unpublish @runner-yufeng/ai-image@X.Y.Z` removes just that version.

## Dry run

To inspect what would ship without publishing:

```bash
npm pack --dry-run
```

The output lists every file that will be included in the tarball.
