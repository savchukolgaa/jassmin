// Runs before every test file (#143): the app's rate limiters count in a fresh in-memory store
// instead of the `rate_limits` table, so tests never write to the development database and
// counters never carry over between runs. The table itself is tested with its own throwaway
// database (`db/queries/rate-limits.test.ts`, `rate-limit.test.ts`).
import { createMemoryRateLimitStore, setAppRateLimitStore } from "~/.server/rate-limit";

setAppRateLimitStore(createMemoryRateLimitStore());
