---
name: ai-image
description: Generate images via the `ai-image` CLI (zero install — runs via bunx/npx). Prefers AI Studio free tier (GEMINI_API_KEY) and falls back to Vertex AI on quota errors. Supports Nano Banana / NB Pro, Imagen, and OpenAI gpt-image-1. Use when the user asks to generate, create, or edit images.
---

# ai-image

Generates images via the `@runner-yufeng/ai-image` CLI.

**Invocation:** use `bunx @runner-yufeng/ai-image "..."` (or `npx @runner-yufeng/ai-image "..."` if bun is unavailable). If the user has installed the CLI globally, the bare command `ai-image "..."` also works.

Routing for `google/*` models:
1. **AI Studio** (`GEMINI_API_KEY`) — free tier, preferred
2. **Vertex AI** (`GOOGLE_CLOUD_PROJECT`) — fallback on HTTP 429/403/404 or quota errors

`openai/*` models go direct to OpenAI.

## When to use

- "generate an image of …"
- "create a picture / graphic / logo …"
- Visual assets for UIs, blog posts, slides.

## Basic usage

```bash
bunx @runner-yufeng/ai-image "a banana astronaut on mars"                 # default: Nano Banana via AI Studio
bunx @runner-yufeng/ai-image "sunset cliffs" -a 16:9 -o hero.png
bunx @runner-yufeng/ai-image "minimalist logo" -m openai/gpt-image-1
bunx @runner-yufeng/ai-image "photoreal cliff" -m google/imagen-4.0-generate-001   # Vertex-only model
bunx @runner-yufeng/ai-image "prompt" --force-vertex                      # skip AI Studio
```

## Model picker

| Model | Free tier? | Best for |
|---|---|---|
| `google/gemini-2.5-flash-image` | ✓ AI Studio | **Default.** Nano Banana — character consistency, fast |
| `google/gemini-3-pro-image-preview` | ✓ AI Studio (preview) | Nano Banana Pro — photoreal, 4K |
| `google/imagen-4.0-generate-001` | Vertex-only | Imagen 4, highest fidelity |
| `google/imagen-3.0-generate-002` | varies | Imagen 3 |
| `openai/gpt-image-1` | OpenAI direct | Text rendering, precise prompts |

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

## Troubleshooting

- **`GEMINI_API_KEY not set`** → Create at https://aistudio.google.com/apikey, then `echo "GEMINI_API_KEY=..." >> ~/.ai-image/.env`
- **`Could not load the default credentials`** → `gcloud auth application-default login`
- **Vertex: `Permission denied` / API not enabled** → `gcloud services enable aiplatform.googleapis.com --project=$GOOGLE_CLOUD_PROJECT`
- **Model not found on Vertex** → Some previews only live in `us-central1`.
