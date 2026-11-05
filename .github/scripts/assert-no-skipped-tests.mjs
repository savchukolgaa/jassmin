// Fails CI when the vitest run skipped any test (#142). The database tests skip themselves when no
// database is configured (`describe.skipIf(!hasDatabase)`), so a broken PostgreSQL service would
// otherwise turn them green without running. Usage:
//   node .github/scripts/assert-no-skipped-tests.mjs vitest-report.json
// The report comes from `vitest run --reporter=json --outputFile.json=<path>`. See docs/ci.md.
import { readFileSync } from "node:fs";
import { relative } from "node:path";

/**
 * Tests that may be skipped in CI, as `<file> › <full test name>`. Keep it empty unless a test
 * genuinely can't run on the Linux runner, and say why next to the entry.
 */
const ALLOWED_SKIPS = [];

const SKIPPED = new Set(["skipped", "pending", "todo"]);

function fail(message) {
  console.error(`::error::${message}`);
  process.exit(1);
}

const reportPath = process.argv[2];
if (!reportPath) {
  fail("Usage: node .github/scripts/assert-no-skipped-tests.mjs <vitest-report.json>");
}

let report;
try {
  report = JSON.parse(readFileSync(reportPath, "utf8"));
} catch (error) {
  fail(`Could not read the vitest report ${reportPath} (did vitest crash?): ${error.message}`);
}

if (!Array.isArray(report.testResults)) {
  fail(`${reportPath} is not a vitest JSON report: it has no testResults.`);
}

let total = 0;
const skipped = [];
for (const file of report.testResults) {
  const path = relative(process.cwd(), file.name).replaceAll("\\", "/");
  for (const test of file.assertionResults ?? []) {
    total += 1;
    const id = `${path} › ${test.fullName}`;
    if (SKIPPED.has(test.status) && !ALLOWED_SKIPS.includes(id)) {
      skipped.push(id);
    }
  }
}

if (skipped.length > 0) {
  for (const id of skipped) {
    console.error(`::error::Skipped in CI: ${id}`);
  }
  fail(
    `${skipped.length} of ${total} tests were skipped. Is the PostgreSQL service up and ` +
      "DATABASE_URL set? Tests must not be skipped in CI (see docs/ci.md).",
  );
}

console.log(`No skipped tests (${total} checked).`);
