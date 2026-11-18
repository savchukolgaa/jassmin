import { type AiEnv, getEnv } from "../env";

/** How to reach the perfumer's model (#162). */
export interface PerfumerConfig {
  /** Without a trailing slash; `/chat/completions` is appended. */
  baseUrl: string;
  model: string;
  apiKey: string | undefined;
  timeoutMs: number;
  /** Ollama's `keep_alive`, sent only when set. */
  keepAlive: string | undefined;
}

/** The perfumer's configuration, or `null` when `AI_BASE_URL` is unset (the perfumer is off). */
export function getPerfumerConfig(env: AiEnv = getEnv()): PerfumerConfig | null {
  if (!env.AI_BASE_URL) {
    return null;
  }
  return {
    baseUrl: env.AI_BASE_URL,
    model: env.AI_MODEL,
    apiKey: env.AI_API_KEY,
    timeoutMs: env.AI_TIMEOUT_MS,
    keepAlive: env.AI_KEEP_ALIVE,
  };
}

/**
 * The provider the perfumer's messages go to, for the privacy policy (#167): `AI_PROVIDER_NAME`
 * while the perfumer is on, else `null` (off, or a model on the shop's own server).
 */
export function getAiProviderName(env: AiEnv = getEnv()): string | null {
  return isPerfumerEnabled(env) ? (env.AI_PROVIDER_NAME ?? null) : null;
}

/** Whether the AI perfumer is configured, so the UI (#163) can hide itself when it isn't. */
export function isPerfumerEnabled(env: AiEnv = getEnv()): boolean {
  return getPerfumerConfig(env) !== null;
}
