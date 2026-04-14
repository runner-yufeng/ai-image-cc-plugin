#!/usr/bin/env bun
import {
  experimental_generateImage as generateImage,
  generateText,
  APICallError,
  type LanguageModel,
  type ImageModel,
} from "ai";
import { openai } from "@ai-sdk/openai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createVertex } from "@ai-sdk/google-vertex";
import { writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { config as dotenvConfig } from "dotenv";
import mri from "mri";
import pkg from "../package.json" with { type: "json" };

export const CONFIG_DIR = join(homedir(), ".ai-image");
export const ENV_FILE = join(CONFIG_DIR, ".env");
export const DEFAULT_MODEL = "google/gemini-2.5-flash-image";

export type Kind = "image" | "multimodal";
export type ImgOut = { bytes: Uint8Array; ext: string };

export interface GenerateOptions {
  prompt: string;
  count: number;
  aspect?: string;
}

export interface RunOptions extends GenerateOptions {
  modelId: string;
}

export function loadEnvFile(path = ENV_FILE): void {
  // override: false → shell env wins over file, preserving previous behavior
  dotenvConfig({ path, override: false, quiet: true });
}

export function parseModelSlug(slug: string): { provider: string; modelId: string } {
  const slash = slug.indexOf("/");
  if (slash <= 0) throw new Error(`model must be "provider/id" (got "${slug}")`);
  return { provider: slug.slice(0, slash), modelId: slug.slice(slash + 1) };
}

export function isMultimodalLLM(id: string): boolean {
  return /gemini.*image/i.test(id) || /nano-banana/i.test(id);
}

export function shouldFallbackToVertex(
  err: unknown,
): { fallback: boolean; why: string } {
  if (APICallError.isInstance(err)) {
    const code = err.statusCode;
    if (code === 429) return { fallback: true, why: "HTTP 429 (quota/rate limit)" };
    if (code === 403) return { fallback: true, why: "HTTP 403 (quota/permission)" };
    if (code === 404) return { fallback: true, why: "HTTP 404 (model unavailable)" };
  }
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
  if (/quota|rate.?limit|exhausted|too many|resource.?exhausted/.test(msg)) {
    return { fallback: true, why: "quota/rate limit error" };
  }
  if (/not.?found|unavailable|not.?supported/.test(msg)) {
    return { fallback: true, why: "model not available on AI Studio" };
  }
  return { fallback: false, why: "" };
}

export async function runWithModel(
  model: LanguageModel | ImageModel,
  kind: Kind,
  opts: GenerateOptions,
): Promise<ImgOut[]> {
  const { prompt, count, aspect } = opts;
  if (kind === "multimodal") {
    const tasks = Array.from({ length: count }, () =>
      generateText({ model: model as LanguageModel, prompt }),
    );
    const results = await Promise.all(tasks);
    const out: ImgOut[] = [];
    for (const r of results) {
      for (const f of r.files.filter((f) => f.mediaType?.startsWith("image/"))) {
        const ext = f.mediaType?.split("/")[1]?.split("+")[0] ?? "png";
        out.push({ bytes: f.uint8Array, ext });
      }
    }
    return out;
  }
  const r = await generateImage({
    model: model as ImageModel,
    prompt,
    n: count,
    ...(aspect && { aspectRatio: aspect as `${number}:${number}` }),
  });
  return r.images.map((img) => ({ bytes: img.uint8Array, ext: "png" }));
}

export async function runOpenAI(
  opts: RunOptions,
): Promise<{ images: ImgOut[]; via: string }> {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error(
      `OPENAI_API_KEY not set.\n  echo "OPENAI_API_KEY=sk-..." >> ${ENV_FILE}`,
    );
  }
  const images = await runWithModel(openai.image(opts.modelId), "image", opts);
  return { images, via: "OpenAI" };
}

export async function runAIStudio(opts: RunOptions & { kind: Kind }): Promise<ImgOut[]> {
  const googleAI = createGoogleGenerativeAI({ apiKey: process.env.GEMINI_API_KEY });
  const model =
    opts.kind === "multimodal" ? googleAI(opts.modelId) : googleAI.image(opts.modelId);
  return runWithModel(model, opts.kind, opts);
}

export async function runVertex(opts: RunOptions & { kind: Kind }): Promise<ImgOut[]> {
  const project = process.env.GOOGLE_CLOUD_PROJECT || process.env.GOOGLE_VERTEX_PROJECT;
  const location =
    process.env.GOOGLE_CLOUD_LOCATION ||
    process.env.GOOGLE_VERTEX_LOCATION ||
    "us-central1";
  if (!project) {
    throw new Error(
      `GOOGLE_CLOUD_PROJECT not set for Vertex fallback.\n  echo "GOOGLE_CLOUD_PROJECT=your-project" >> ${ENV_FILE}`,
    );
  }
  const vertex = createVertex({ project, location });
  const model =
    opts.kind === "multimodal" ? vertex(opts.modelId) : vertex.image(opts.modelId);
  return runWithModel(model, opts.kind, opts);
}

export async function runGoogle(
  opts: RunOptions & { forceVertex: boolean },
): Promise<{ images: ImgOut[]; via: string }> {
  const kind: Kind = isMultimodalLLM(opts.modelId) ? "multimodal" : "image";
  const slug = `google/${opts.modelId}`;

  if (!opts.forceVertex && process.env.GEMINI_API_KEY) {
    try {
      console.log(`→ AI Studio (free tier): ${slug}`);
      const images = await runAIStudio({ ...opts, kind });
      return { images, via: "AI Studio" };
    } catch (err) {
      const { fallback, why } = shouldFallbackToVertex(err);
      if (!fallback) throw err;
      const detail = err instanceof Error ? err.message.split("\n")[0] : String(err);
      console.log(`  AI Studio → ${why}: ${detail}`);
      console.log(`  falling back to Vertex AI...`);
    }
  }

  console.log(`→ Vertex AI: ${slug}`);
  const images = await runVertex({ ...opts, kind });
  return { images, via: "Vertex" };
}

export function nameFor(
  i: number,
  ext: string,
  output: string | undefined,
  count: number,
  stamp: number,
): string {
  if (output) {
    return count > 1 ? output.replace(/(\.\w+)?$/, `-${i + 1}$1`) : output;
  }
  return `ai-image-${stamp}${i > 0 ? `-${i + 1}` : ""}.${ext}`;
}

const HELP = `ai-image — AI Image Generation

Routing for google/* models:
  1. AI Studio (GEMINI_API_KEY)     free tier, preferred
  2. Vertex AI (GOOGLE_CLOUD_*)     fallback on quota/rate-limit errors

Usage:
  ai-image "your prompt"
  ai-image "prompt" -m openai/gpt-image-1
  ai-image "prompt" -m google/imagen-4.0-generate-001 -o hero.png

Models:
  google/gemini-2.5-flash-image           Nano Banana (default, free tier)
  google/gemini-3-pro-image-preview       Nano Banana Pro
  google/imagen-4.0-generate-001          Imagen 4 (Vertex-only)
  google/imagen-3.0-generate-002          Imagen 3
  openai/gpt-image-1                      OpenAI gpt-image-1

Options:
  -m, --model        Model slug [default: ${DEFAULT_MODEL}]
  -o, --output       Output filename [default: ai-image-{timestamp}.png]
  -n, --count        Number of images [default: 1]
  -a, --aspect       Aspect ratio, e.g. 1:1, 16:9, 9:16
      --force-vertex Skip AI Studio, go straight to Vertex
  -h, --help         Show this help
      --version      Print version and exit

Auth (${ENV_FILE}):
  GEMINI_API_KEY=...                 AI Studio free tier (preferred)
  GOOGLE_CLOUD_PROJECT=...           Vertex AI fallback
  GOOGLE_CLOUD_LOCATION=us-central1  (optional)
  OPENAI_API_KEY=sk-...              OpenAI models
`;

export interface ParsedArgs {
  prompt: string;
  modelSlug: string;
  output?: string;
  count: number;
  aspect?: string;
  forceVertex: boolean;
  help: boolean;
  version: boolean;
}

export function parseArgs(argv: string[]): ParsedArgs {
  const raw = mri(argv, {
    alias: { m: "model", o: "output", n: "count", a: "aspect", h: "help" },
    boolean: ["help", "version", "force-vertex"],
    string: ["model", "output", "aspect"],
    default: { model: DEFAULT_MODEL, count: 1 },
  });

  const countRaw = raw.count;
  const count = typeof countRaw === "number" ? countRaw : Number(countRaw);
  if (!Number.isInteger(count) || count < 1) {
    throw new Error(`--count/-n must be a positive integer (got "${countRaw}")`);
  }

  return {
    prompt: typeof raw._[0] === "string" ? raw._[0] : "",
    modelSlug: String(raw.model),
    output: raw.output ? String(raw.output) : undefined,
    count,
    aspect: raw.aspect ? String(raw.aspect) : undefined,
    forceVertex: Boolean(raw["force-vertex"]),
    help: Boolean(raw.help),
    version: Boolean(raw.version),
  };
}

export async function main(argv: string[]): Promise<number> {
  loadEnvFile();

  if (argv.length === 0) {
    console.log(HELP);
    return 1;
  }

  let args: ParsedArgs;
  try {
    args = parseArgs(argv);
  } catch (err) {
    console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  }

  if (args.version) {
    console.log(pkg.version);
    return 0;
  }

  if (args.help) {
    console.log(HELP);
    return 0;
  }

  if (!args.prompt) {
    console.error('Error: prompt required. Try: ai-image "a sunset"');
    return 1;
  }

  const { provider, modelId } = parseModelSlug(args.modelSlug);

  const runOpts: RunOptions & { forceVertex: boolean } = {
    modelId,
    prompt: args.prompt,
    count: args.count,
    aspect: args.aspect,
    forceVertex: args.forceVertex,
  };

  let result: { images: ImgOut[]; via: string };
  if (provider === "openai") {
    result = await runOpenAI(runOpts);
  } else if (provider === "google" || provider === "vertex") {
    result = await runGoogle(runOpts);
  } else {
    console.error(`Error: unknown provider "${provider}" (supported: openai, google)`);
    return 1;
  }

  if (result.images.length === 0) {
    console.error("Error: no images returned");
    return 1;
  }

  const stamp = Date.now();
  for (let i = 0; i < result.images.length; i++) {
    const img = result.images[i];
    const filename = nameFor(i, img.ext, args.output, args.count, stamp);
    writeFileSync(filename, img.bytes);
    console.log(`✓ ${resolve(filename)}`);
  }
  console.log(`  via ${result.via}`);
  return 0;
}

if (import.meta.main) {
  main(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch((err) => {
      console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    });
}
