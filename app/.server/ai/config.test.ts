import { describe, expect, it } from "vitest";
import { parseAiEnv } from "../env";
import { getPerfumerConfig, isPerfumerEnabled } from "./config";

describe("perfumer config", () => {
  it("is disabled without AI_BASE_URL", () => {
    const env = parseAiEnv({});
    expect(getPerfumerConfig(env)).toBeNull();
    expect(isPerfumerEnabled(env)).toBe(false);
  });

  it("is enabled with AI_BASE_URL and carries the model settings", () => {
    const env = parseAiEnv({
      AI_BASE_URL: "http://localhost:11434/v1",
      AI_KEEP_ALIVE: "30m",
    });
    expect(isPerfumerEnabled(env)).toBe(true);
    expect(getPerfumerConfig(env)).toEqual({
      baseUrl: "http://localhost:11434/v1",
      model: "granite4.1:3b",
      apiKey: undefined,
      timeoutMs: 90_000,
      keepAlive: "30m",
    });
  });
});
