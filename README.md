# ai-image-cc-plugin

An image generation CLI + Claude Code plugin that prefers the **AI Studio free tier** and automatically falls back to **Vertex AI** on quota/rate-limit errors. Also supports OpenAI `gpt-image-1`.

## What it does

- Defaults to Nano Banana (Gemini 2.5 Flash Image) via AI Studio — free tier
- On quota/rate-limit error (HTTP 429/403/404), automatically retries on Vertex AI
- Supports Imagen 3/4, Gemini image models, and OpenAI `gpt-image-1`
- Ships as both a standalone CLI and a Claude Code skill

## Prerequisites

- [Bun](https://bun.sh) (required to run the CLI)
- A `GEMINI_API_KEY` from [Google AI Studio](https://aistudio.google.com/apikey) — free tier
- For Vertex fallback: a GCP project with the Vertex AI API enabled, plus `gcloud` CLI and ADC login
- For OpenAI models: `OPENAI_API_KEY`

## Install

### 1. CLI (required)

```bash
git clone https://github.com/runner-yufeng/ai-image-cc-plugin.git ~/tools/ai-image
cd ~/tools/ai-image
bun install
bun link
```

This makes `ai-image` available globally.

### 2. Claude Code plugin (optional — integrates with Claude Code sessions)

In any Claude Code session:

```
/plugin marketplace add runner-yufeng/ai-image-cc-plugin
/plugin install ai-image@ai-image-cc-plugin-marketplace
```

After the plugin is installed, Claude invokes the `ai-image` CLI when you ask it to generate images.

### 3. Configure

Copy `.env.example` to `~/.ai-image/.env` and fill in your keys:

```bash
mkdir -p ~/.ai-image
cp .env.example ~/.ai-image/.env
# edit ~/.ai-image/.env
```

For Vertex fallback also run:

```bash
gcloud auth application-default login
gcloud services enable aiplatform.googleapis.com --project=YOUR_PROJECT
```

## Usage

```bash
ai-image "a banana astronaut on mars"                       # default: Nano Banana
ai-image "sunset cliffs" -a 16:9 -o hero.png
ai-image "photoreal cliff" -m google/imagen-4.0-generate-001  # Vertex-only model
ai-image "minimalist logo" -m openai/gpt-image-1
ai-image "prompt" --force-vertex                            # skip AI Studio
ai-image "prompt" -n 4                                      # multiple variations
```

### Models

| Model | Free tier? | Best for |
|---|---|---|
| `google/gemini-2.5-flash-image` | ✓ AI Studio | **Default.** Nano Banana — character consistency, fast |
| `google/gemini-3-pro-image-preview` | ✓ AI Studio (preview) | Nano Banana Pro — photoreal, 4K |
| `google/imagen-4.0-generate-001` | Vertex-only | Imagen 4, highest fidelity |
| `google/imagen-3.0-generate-002` | varies | Imagen 3 |
| `openai/gpt-image-1` | OpenAI direct | Text rendering, precise prompts |

Model IDs change over time — check current availability at:
- AI Studio: https://ai.google.dev/gemini-api/docs/models
- Vertex AI: https://cloud.google.com/vertex-ai/generative-ai/docs/image/overview
- OpenAI: https://platform.openai.com/docs/models

## Fallback behavior

When AI Studio fails, the CLI logs the reason and retries on Vertex:

```
→ AI Studio (free tier): google/gemini-2.5-flash-image
  AI Studio → HTTP 429 (quota/rate limit): You exceeded your current quota...
  falling back to Vertex AI...
→ Vertex AI: google/gemini-2.5-flash-image
✓ /Users/you/ai-image-1776188527817.png
  via Vertex
```

Fallback triggers: HTTP 429, 403, 404, or error messages matching `quota | rate limit | exhausted | not found | unavailable`.

Non-fallback errors (auth 401, network, malformed prompt) surface immediately.

## Status

Published as v0.1 — works end-to-end but has known rough edges tracked in [GitHub issues](https://github.com/runner-yufeng/ai-image-cc-plugin/issues). Contributions welcome.

## License

MIT
