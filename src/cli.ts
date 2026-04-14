#!/usr/bin/env bun
import {
  experimental_generateImage as generateImage,
  generateText,
  APICallError,
} from "ai";
import { openai } from "@ai-sdk/openai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createVertex } from "@ai-sdk/google-vertex";
import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

const CONFIG_DIR = join(homedir(), ".ai-image");
const ENV_FILE = join(CONFIG_DIR, ".env");

if (existsSync(ENV_FILE)) {
  for (const line of readFileSync(ENV_FILE, "utf-8").split("\n")) {
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    const val = line.slice(eq + 1).trim();
    if (key && !process.env[key]) process.env[key] = val;
  }
}

const args = process.argv.slice(2);

if (args.length === 0 || args.includes("-h") || args.includes("--help")) {
  console.log(`ai-image — AI Image Generation

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
  -m, --model        Model slug [default: google/gemini-2.5-flash-image]
  -o, --output       Output filename [default: ai-image-{timestamp}.png]
  -n, --count        Number of images [default: 1]
  -a, --aspect       Aspect ratio, e.g. 1:1, 16:9, 9:16
      --force-vertex Skip AI Studio, go straight to Vertex
  -h, --help         Show this help

Auth (${ENV_FILE}):
  GEMINI_API_KEY=...                 AI Studio free tier (preferred)
  GOOGLE_CLOUD_PROJECT=...           Vertex AI fallback
  GOOGLE_CLOUD_LOCATION=us-central1  (optional)
  OPENAI_API_KEY=sk-...              OpenAI models
`);
  process.exit(args.length === 0 ? 1 : 0);
}

let prompt = "";
let modelSlug = "google/gemini-2.5-flash-image";
let output: string | undefined;
let count = 1;
let aspect: string | undefined;
let forceVertex = false;

for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === "-m" || a === "--model") modelSlug = args[++i];
  else if (a === "-o" || a === "--output") output = args[++i];
  else if (a === "-n" || a === "--count") count = Number(args[++i]);
  else if (a === "-a" || a === "--aspect") aspect = args[++i];
  else if (a === "--force-vertex") forceVertex = true;
  else if (!prompt) prompt = a;
}

if (!prompt) {
  console.error('Error: prompt required. Try: ai-image "a sunset"');
  process.exit(1);
}

const slash = modelSlug.indexOf("/");
if (slash <= 0) {
  console.error(`Error: model must be "provider/id" (got "${modelSlug}")`);
  process.exit(1);
}
const provider = modelSlug.slice(0, slash);
const modelId = modelSlug.slice(slash + 1);

type Kind = "image" | "multimodal";
const isMultimodalLLM = (id: string) =>
  /gemini.*image/i.test(id) || /nano-banana/i.test(id);

type ImgOut = { bytes: Uint8Array; ext: string };

async function runWithModel(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  model: any,
  kind: Kind,
): Promise<ImgOut[]> {
  if (kind === "multimodal") {
    const tasks = Array.from({ length: count }, () =>
      generateText({ model, prompt }),
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
    model,
    prompt,
    n: count,
    ...(aspect && { aspectRatio: aspect as `${number}:${number}` }),
  });
  return r.images.map((img) => ({ bytes: img.uint8Array, ext: "png" }));
}

function shouldFallbackToVertex(err: unknown): { fallback: boolean; why: string } {
  if (APICallError.isInstance(err)) {
    const code = err.statusCode;
    if (code === 429) return { fallback: true, why: `HTTP 429 (quota/rate limit)` };
    if (code === 403) return { fallback: true, why: `HTTP 403 (quota/permission)` };
    if (code === 404) return { fallback: true, why: `HTTP 404 (model unavailable)` };
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

async function runOpenAI(): Promise<{ images: ImgOut[]; via: string }> {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error(
      `OPENAI_API_KEY not set.\n  echo "OPENAI_API_KEY=sk-..." >> ${ENV_FILE}`,
    );
  }
  const images = await runWithModel(openai.image(modelId), "image");
  return { images, via: "OpenAI" };
}

async function runAIStudio(kind: Kind): Promise<ImgOut[]> {
  const googleAI = createGoogleGenerativeAI({
    apiKey: process.env.GEMINI_API_KEY,
  });
  const model = kind === "multimodal" ? googleAI(modelId) : googleAI.image(modelId);
  return runWithModel(model, kind);
}

async function runVertex(kind: Kind): Promise<ImgOut[]> {
  const project =
    process.env.GOOGLE_CLOUD_PROJECT || process.env.GOOGLE_VERTEX_PROJECT;
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
  const model = kind === "multimodal" ? vertex(modelId) : vertex.image(modelId);
  return runWithModel(model, kind);
}

async function runGoogle(): Promise<{ images: ImgOut[]; via: string }> {
  const kind: Kind = isMultimodalLLM(modelId) ? "multimodal" : "image";

  if (!forceVertex && process.env.GEMINI_API_KEY) {
    try {
      console.log(`→ AI Studio (free tier): ${modelSlug}`);
      const images = await runAIStudio(kind);
      return { images, via: "AI Studio" };
    } catch (err) {
      const { fallback, why } = shouldFallbackToVertex(err);
      if (!fallback) throw err;
      const detail = err instanceof Error ? err.message.split("\n")[0] : String(err);
      console.log(`  AI Studio → ${why}: ${detail}`);
      console.log(`  falling back to Vertex AI...`);
    }
  }

  console.log(`→ Vertex AI: ${modelSlug}`);
  const images = await runVertex(kind);
  return { images, via: "Vertex" };
}

const stamp = Date.now();
const nameFor = (i: number, ext: string) => {
  if (output) {
    return count > 1 ? output.replace(/(\.\w+)?$/, `-${i + 1}$1`) : output;
  }
  return `ai-image-${stamp}${i > 0 ? `-${i + 1}` : ""}.${ext}`;
};

try {
  let result: { images: ImgOut[]; via: string };
  if (provider === "openai") {
    result = await runOpenAI();
  } else if (provider === "google" || provider === "vertex") {
    result = await runGoogle();
  } else {
    console.error(`Error: unknown provider "${provider}" (supported: openai, google)`);
    process.exit(1);
  }

  if (result.images.length === 0) {
    console.error("Error: no images returned");
    process.exit(1);
  }

  for (let i = 0; i < result.images.length; i++) {
    const img = result.images[i];
    const filename = nameFor(i, img.ext);
    writeFileSync(filename, img.bytes);
    console.log(`✓ ${resolve(filename)}`);
  }
  console.log(`  via ${result.via}`);
} catch (err) {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(`Error: ${msg}`);
  process.exit(1);
}
