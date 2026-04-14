import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { APICallError } from "ai";
import {
  parseModelSlug,
  resolveKind,
  shouldFallbackToVertex,
  parseArgs,
  nameFor,
  loadEnvFile,
  DEFAULT_MODEL,
  MULTIMODAL_MODELS,
} from "./cli";

describe("parseModelSlug", () => {
  test("splits provider/id", () => {
    expect(parseModelSlug("openai/gpt-image-1")).toEqual({
      provider: "openai",
      modelId: "gpt-image-1",
    });
  });

  test("handles ids containing slashes", () => {
    expect(parseModelSlug("vertex/publishers/google/models/imagen-3")).toEqual({
      provider: "vertex",
      modelId: "publishers/google/models/imagen-3",
    });
  });

  test("throws on missing slash", () => {
    expect(() => parseModelSlug("gpt-image-1")).toThrow(/provider\/id/);
  });

  test("throws when provider is empty", () => {
    expect(() => parseModelSlug("/gpt-image-1")).toThrow(/provider\/id/);
  });
});

describe("resolveKind", () => {
  test("explicit override wins over allowlist", () => {
    expect(resolveKind("gemini-2.5-flash-image", "image")).toBe("image");
    expect(resolveKind("imagen-4.0-generate-001", "multimodal")).toBe("multimodal");
  });

  test("allowlist match → multimodal", () => {
    for (const id of MULTIMODAL_MODELS) {
      expect(resolveKind(id, undefined)).toBe("multimodal");
    }
  });

  test("non-allowlist non-heuristic → image", () => {
    expect(resolveKind("imagen-4.0-generate-001", undefined)).toBe("image");
    expect(resolveKind("gpt-image-1", undefined)).toBe("image");
  });

  test("heuristic fallback warns and returns multimodal", () => {
    // Capture stderr
    const originalWrite = process.stderr.write.bind(process.stderr);
    let captured = "";
    process.stderr.write = ((chunk: string | Uint8Array) => {
      captured += typeof chunk === "string" ? chunk : Buffer.from(chunk).toString();
      return true;
    }) as typeof process.stderr.write;
    try {
      // "gemini-99-experimental-image" is not in allowlist but matches the heuristic
      expect(resolveKind("gemini-99-experimental-image", undefined)).toBe("multimodal");
      expect(captured).toContain("warning");
      expect(captured).toContain("gemini-99-experimental-image");
    } finally {
      process.stderr.write = originalWrite;
    }
  });
});

describe("shouldFallbackToVertex", () => {
  const makeApiError = (statusCode: number) =>
    new APICallError({
      message: "api error",
      url: "https://example.com",
      requestBodyValues: {},
      statusCode,
    });

  test("HTTP 429 → fallback with reason", () => {
    expect(shouldFallbackToVertex(makeApiError(429))).toEqual({
      fallback: true,
      why: "HTTP 429 (quota/rate limit)",
    });
  });

  test("HTTP 403 → fallback", () => {
    expect(shouldFallbackToVertex(makeApiError(403)).fallback).toBe(true);
  });

  test("HTTP 404 → fallback", () => {
    expect(shouldFallbackToVertex(makeApiError(404)).fallback).toBe(true);
  });

  test("HTTP 401 → no fallback (auth error, not quota)", () => {
    expect(shouldFallbackToVertex(makeApiError(401)).fallback).toBe(false);
  });

  test("HTTP 500 → no fallback (transient upstream, retry-worthy but not our job here)", () => {
    expect(shouldFallbackToVertex(makeApiError(500)).fallback).toBe(false);
  });

  test("plain Error with quota message → fallback", () => {
    const r = shouldFallbackToVertex(new Error("You exceeded your current quota"));
    expect(r.fallback).toBe(true);
    expect(r.why).toMatch(/quota/i);
  });

  test("plain Error with rate-limit message → fallback", () => {
    expect(shouldFallbackToVertex(new Error("rate limit hit")).fallback).toBe(true);
  });

  test("plain Error with not-found message → fallback", () => {
    const r = shouldFallbackToVertex(new Error("model not found"));
    expect(r.fallback).toBe(true);
    expect(r.why).toMatch(/not available/i);
  });

  test("plain Error with unrelated message → no fallback", () => {
    expect(shouldFallbackToVertex(new Error("network ECONNRESET")).fallback).toBe(false);
  });

  test("non-Error value → no fallback", () => {
    expect(shouldFallbackToVertex("something weird").fallback).toBe(false);
  });
});

describe("parseArgs", () => {
  test("defaults when only prompt given", () => {
    const a = parseArgs(["a sunset"]);
    expect(a.prompt).toBe("a sunset");
    expect(a.modelSlug).toBe(DEFAULT_MODEL);
    expect(a.count).toBe(1);
    expect(a.forceVertex).toBe(false);
    expect(a.json).toBe(false);
    expect(a.help).toBe(false);
    expect(a.version).toBe(false);
    expect(a.kindOverride).toBeUndefined();
  });

  test("short aliases (-m -o -n -a -d -h)", () => {
    const a = parseArgs([
      "-m",
      "openai/gpt-image-1",
      "-o",
      "hero.png",
      "-n",
      "3",
      "-a",
      "16:9",
      "-d",
      "/tmp/out",
      "prompt here",
    ]);
    expect(a.modelSlug).toBe("openai/gpt-image-1");
    expect(a.output).toBe("hero.png");
    expect(a.count).toBe(3);
    expect(a.aspect).toBe("16:9");
    expect(a.outputDir).toBe("/tmp/out");
    expect(a.prompt).toBe("prompt here");
  });

  test("--flag=value syntax", () => {
    const a = parseArgs(["--count=5", "--model=openai/gpt-image-1", "prompt"]);
    expect(a.count).toBe(5);
    expect(a.modelSlug).toBe("openai/gpt-image-1");
  });

  test("boolean flags", () => {
    const a = parseArgs(["--force-vertex", "--json", "prompt"]);
    expect(a.forceVertex).toBe(true);
    expect(a.json).toBe(true);
  });

  test("--help", () => {
    expect(parseArgs(["--help"]).help).toBe(true);
    expect(parseArgs(["-h"]).help).toBe(true);
  });

  test("--version", () => {
    expect(parseArgs(["--version"]).version).toBe(true);
  });

  test("--multimodal sets kindOverride=multimodal", () => {
    expect(parseArgs(["--multimodal", "p"]).kindOverride).toBe("multimodal");
  });

  test("--image-only sets kindOverride=image", () => {
    expect(parseArgs(["--image-only", "p"]).kindOverride).toBe("image");
  });

  test("--multimodal and --image-only together throws", () => {
    expect(() => parseArgs(["--multimodal", "--image-only", "p"])).toThrow(
      /mutually exclusive/,
    );
  });

  test("invalid --count values throw", () => {
    expect(() => parseArgs(["-n", "abc", "p"])).toThrow(/positive integer/);
    expect(() => parseArgs(["-n", "0", "p"])).toThrow(/positive integer/);
    // Use --count=-3 form: -n -3 is ambiguous to mri (reads -3 as a short flag).
    expect(() => parseArgs(["--count=-3", "p"])).toThrow(/positive integer/);
    expect(() => parseArgs(["-n", "1.5", "p"])).toThrow(/positive integer/);
  });

  test("prompt omitted → empty string (main handles stdin fallback)", () => {
    expect(parseArgs(["--help"]).prompt).toBe("");
    expect(parseArgs([]).prompt).toBe("");
  });
});

describe("nameFor", () => {
  const stamp = 1234567890;

  test("single image with default name", () => {
    expect(nameFor(0, "png", undefined, 1, stamp)).toBe("ai-image-1234567890.png");
  });

  test("multiple images with default name gets suffix", () => {
    expect(nameFor(0, "png", undefined, 3, stamp)).toBe("ai-image-1234567890.png");
    expect(nameFor(1, "png", undefined, 3, stamp)).toBe("ai-image-1234567890-2.png");
    expect(nameFor(2, "png", undefined, 3, stamp)).toBe("ai-image-1234567890-3.png");
  });

  test("respects non-png extensions from multimodal", () => {
    expect(nameFor(0, "webp", undefined, 1, stamp)).toBe("ai-image-1234567890.webp");
  });

  test("custom output name, single image", () => {
    expect(nameFor(0, "png", "hero.png", 1, stamp)).toBe("hero.png");
  });

  test("custom output name with multiple images gets suffix before extension", () => {
    expect(nameFor(0, "png", "hero.png", 2, stamp)).toBe("hero-1.png");
    expect(nameFor(1, "png", "hero.png", 2, stamp)).toBe("hero-2.png");
  });

  test("custom output name without extension still gets suffix", () => {
    expect(nameFor(0, "png", "hero", 2, stamp)).toBe("hero-1");
    expect(nameFor(1, "png", "hero", 2, stamp)).toBe("hero-2");
  });
});

describe("loadEnvFile", () => {
  let tmp: string;
  let envPath: string;
  const snapshot = (...keys: string[]) =>
    Object.fromEntries(keys.map((k) => [k, process.env[k]]));

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "ai-image-test-"));
    envPath = join(tmp, ".env");
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
    delete process.env.AI_IMAGE_TEST_QUOTED;
    delete process.env.AI_IMAGE_TEST_PLAIN;
    delete process.env.AI_IMAGE_TEST_EXPORTED;
    delete process.env.AI_IMAGE_TEST_SHELL_WINS;
  });

  test("loads plain KEY=VALUE", () => {
    writeFileSync(envPath, "AI_IMAGE_TEST_PLAIN=hello\n");
    loadEnvFile(envPath);
    expect(process.env.AI_IMAGE_TEST_PLAIN).toBe("hello");
  });

  test("strips surrounding quotes", () => {
    writeFileSync(envPath, 'AI_IMAGE_TEST_QUOTED="with spaces"\n');
    loadEnvFile(envPath);
    expect(process.env.AI_IMAGE_TEST_QUOTED).toBe("with spaces");
  });

  test("handles export prefix", () => {
    writeFileSync(envPath, "export AI_IMAGE_TEST_EXPORTED=exported\n");
    loadEnvFile(envPath);
    expect(process.env.AI_IMAGE_TEST_EXPORTED).toBe("exported");
  });

  test("shell env wins over file (override: false)", () => {
    process.env.AI_IMAGE_TEST_SHELL_WINS = "from-shell";
    writeFileSync(envPath, "AI_IMAGE_TEST_SHELL_WINS=from-file\n");
    loadEnvFile(envPath);
    expect(process.env.AI_IMAGE_TEST_SHELL_WINS).toBe("from-shell");
  });

  test("missing file is silent", () => {
    expect(() => loadEnvFile(join(tmp, "does-not-exist.env"))).not.toThrow();
  });

  test("snapshot works (smoke)", () => {
    expect(snapshot("AI_IMAGE_TEST_PLAIN")).toEqual({
      AI_IMAGE_TEST_PLAIN: undefined,
    });
  });
});
