-- Rolls back 0024_rate_limits.sql. Rate-limit counters go back to process memory only after the
-- code that uses this table is rolled back too.
DROP TABLE "rate_limits";
