import { describe, expect, it } from "vitest";
import { parseAiEnv } from "../env";
import { getAiProviderName, getPerfumerConfig, isPerfumerEnabled } from "./config";

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

  it("names the provider for the privacy policy only while the perfumer is on (#167)", () => {
    const hosted = { AI_BASE_URL: "https://openrouter.ai/api/v1", AI_PROVIDER_NAME: "OpenRouter" };
    expect(getAiProviderName(parseAiEnv(hosted))).toBe("OpenRouter");
    // Off: nothing is sent anywhere.
    expect(getAiProviderName(parseAiEnv({ AI_PROVIDER_NAME: "OpenRouter" }))).toBeNull();
    // Ollama on the shop's own server: no provider to name.
    expect(getAiProviderName(parseAiEnv({ AI_BASE_URL: "http://localhost:11434/v1" }))).toBeNull();
  });
});
