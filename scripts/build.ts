#!/usr/bin/env bun
import { $ } from "bun";
import { readFileSync, writeFileSync, chmodSync } from "node:fs";

await $`bun build src/cli.ts \
  --target=node \
  --outfile=dist/cli.js \
  --external='ai' \
  --external='@ai-sdk/openai' \
  --external='@ai-sdk/google' \
  --external='@ai-sdk/google-vertex'`;

const path = "dist/cli.js";
const body = readFileSync(path, "utf8").replace(/^#![^\n]*\n?/, "");
writeFileSync(path, `#!/usr/bin/env node\n${body}`);
chmodSync(path, 0o755);

console.log(`✓ built ${path}`);
