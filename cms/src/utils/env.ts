/** Fails fast at startup when a required Strapi secret is missing (see `cms/.env.example`). */
export function requireEnv<T>(name: string, value: T | undefined): T {
  if (value === undefined || value === "" || (Array.isArray(value) && value.length === 0)) {
    throw new Error(`Missing required environment variable ${name} (see cms/.env.example)`);
  }
  return value;
}
