---
name: ai-image
description: Generate images via the `@runner-yufeng/ai-image` CLI (zero install — runs via bunx/npx). Prefers AI Studio free tier (GEMINI_API_KEY) and falls back to Vertex AI on quota errors. Supports Nano Banana / NB Pro, Imagen, and OpenAI gpt-image-1 with --json, --output-dir, stdin prompts, and multimodal/image-only overrides. Use when the user asks to generate, create, or edit images.
---

# ai-image

Generates images via the `@runner-yufeng/ai-image` CLI.

**Invocation:** `bunx @runner-yufeng/ai-image "..."` (or `npx @runner-yufeng/ai-image "..."` if bun unavailable). If the user has the CLI linked locally, bare `ai-image "..."` also works. Examples below use `ai-image` for brevity.

Routing for `google/*` models:
1. **AI Studio** (`GEMINI_API_KEY`) — free tier, preferred
2. **Vertex AI** (`GOOGLE_CLOUD_PROJECT`) — fallback on HTTP 429/403/404 or quota errors

`openai/*` models go direct to OpenAI.

## Recipes — map user intent to invocation

| User asks for… | Invoke |
|---|---|
| "generate / create / make an image of X" | `ai-image "X"` |
| "N variants of X" | `ai-image "X" -n N` |
| "asset for this component / page" | `ai-image "X" -d ./public/images -o descriptive-name.png` |
| "photorealistic / 4K hero / product photo / landscape" | `ai-image "X" -m google/gemini-3-pro-image-preview -a 16:9` |
| "logo / text inside the image / typography" | `ai-image "X" -m openai/gpt-image-1` |
| "isometric / icon / Imagen fidelity" | `ai-image "X" -m google/imagen-4.0-generate-001 -a 1:1` |
| Claude needs the file path programmatically | `ai-image "X" --json` → parse `.files[0]` |
| Prompt built from another command | `printf "…" \| ai-image` |
| "Skip AI Studio / use GCP directly" | `ai-image "X" --force-vertex` |
| New Gemini model mis-routed | `ai-image "X" --multimodal` (or `--image-only` for the inverse) |

**Save UI assets under the project's `public/` or `assets/` directory** via `-d`, not in cwd.

## Streams

- **stdout**: final result only — `✓ /abs/path.png` + `via <backend>` in human mode, or `{"files":[…],"via":…,"model":…}` in `--json` mode.
- **stderr**: diagnostics — `→ AI Studio…`, `falling back to Vertex…`, heuristic warnings.

This means `ai-image "X" --json 2>/dev/null | jq -r '.files[0]'` cleanly captures the output path for downstream steps.

## Model picker

| Model | Free tier? | Best for |
|---|---|---|
| `google/gemini-2.5-flash-image` | ✓ AI Studio | **Default.** Nano Banana — fast, character consistency, edits |
| `google/gemini-3-pro-image-preview` | ✓ AI Studio (preview) | Nano Banana Pro — photoreal, 4K |
| `google/imagen-4.0-generate-001` | Vertex-only | Imagen 4, highest fidelity |
| `google/imagen-3.0-generate-002` | varies | Imagen 3 |
| `openai/gpt-image-1` | OpenAI direct | Text rendering, precise prompts |

Model IDs drift — if one errors with `not found`, fall back to default and note it for the user.

## Cost & quota awareness

- AI Studio free tier on Nano Banana is **tight (~10/day)**. After exhaustion, every call silently falls back to Vertex (paid).
- Typical Vertex costs: Nano Banana ~$0.04/image, NB Pro ~$0.13 (2K) / ~$0.24 (4K), Imagen 4 ~$0.04, OpenAI gpt-image-1 ~$0.04 (1024²).
- For batch generation (`-n 5+`), warn the user that AI Studio quota will be exhausted and subsequent calls run on Vertex billing. Consider `--force-vertex` for predictable billing.
- Don't default to NB Pro for drafts — use the default model and upgrade only for finals.

## Auth

Config file: `~/.ai-image/.env`

```
GEMINI_API_KEY=...                    # https://aistudio.google.com/apikey (preferred)
GOOGLE_CLOUD_PROJECT=your-project     # Vertex fallback
GOOGLE_CLOUD_LOCATION=us-central1     # optional
OPENAI_API_KEY=sk-...                 # only if using openai/*
```

Vertex also requires ADC:

```bash
gcloud auth application-default login
```

## Flags reference

| Flag | Purpose |
|---|---|
| `-m, --model <slug>` | Model ID (default `google/gemini-2.5-flash-image`) |
| `-o, --output <file>` | Output filename |
| `-d, --output-dir <dir>` | Write into directory (mkdir -p) |
| `-n, --count <N>` | Number of images (positive integer) |
| `-a, --aspect <W:H>` | Aspect ratio, e.g. `1:1`, `16:9`, `9:16` |
| `--force-vertex` | Skip AI Studio, go straight to Vertex |
| `--multimodal` / `--image-only` | Override routing heuristic (mutually exclusive) |
| `--json` | Emit `{files,via,model}` JSON on stdout, logs → stderr |
| `-h, --help` | Print help |
| `--version` | Print CLI version |

## Troubleshooting

- **`GEMINI_API_KEY not set`** → Create at https://aistudio.google.com/apikey, then `echo "GEMINI_API_KEY=..." >> ~/.ai-image/.env`.
- **`GOOGLE_CLOUD_PROJECT not set for Vertex fallback`** → Set in config or skip Vertex entirely by only using AI Studio.
- **`Could not load the default credentials`** → `gcloud auth application-default login`.
- **Vertex: `Permission denied` / API not enabled** → `gcloud services enable aiplatform.googleapis.com --project=$GOOGLE_CLOUD_PROJECT`.
- **`"<model>" is not in the multimodal allowlist but matches the heuristic`** → Either allowlist is outdated (file a PR to add) or model is genuinely image-only — pass `--image-only` to override.
- **Model not found on Vertex** → Some previews only live in `us-central1`.
