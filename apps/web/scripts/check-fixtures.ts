// Validates every fixture (and the API's own shared fixture) against the Zod contract.
// Run: npm run check:fixtures
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { z } from "zod";

import {
  healthSchema,
  narrativeSchema,
  oppositeTrendsSchema,
  regionPresetsSchema,
  trendMapSchema,
  trendResultSchema,
  variablesSchema,
} from "../lib/schemas";

const DIR = join(__dirname, "..", "fixtures");

const checks: [string, z.ZodType][] = [
  ["health.json", healthSchema],
  ["variables.json", variablesSchema],
  ["regions-presets.json", regionPresetsSchema],
  ["trend.grade-a.json", trendResultSchema],
  ["trend.grade-d.json", trendResultSchema],
  ["trend.null-should.json", trendResultSchema],
  ["trend-at-point.json", trendResultSchema],
  ["narrative.json", narrativeSchema],
  ...["merra2_t2m", "gpm_precip", "modis_ndvi"].flatMap((v): [string, z.ZodType][] => [
    [`trend-map.${v}.west_africa.json`, trendMapSchema],
    [`opposite-trends.${v}.west_africa.json`, oppositeTrendsSchema],
  ]),
];

// The API's own shared fixture: what the real POST /trend returns before data is cached.
checks.push(["../../../packages/shared-schemas/fixtures/trend.fixture.json", trendResultSchema]);

let failed = 0;
for (const [file, schema] of checks) {
  const result = schema.safeParse(JSON.parse(readFileSync(join(DIR, file), "utf8")));
  if (result.success) {
    console.log(`ok    ${file}`);
  } else {
    failed += 1;
    console.log(`FAIL  ${file}`);
    for (const issue of result.error.issues.slice(0, 5)) console.log(`      ${issue.path.join(".")}: ${issue.message}`);
  }
}

// Scenario guarantees the UI relies on.
const nullCase = trendResultSchema.parse(JSON.parse(readFileSync(join(DIR, "trend.null-should.json"), "utf8")));
const nullOk =
  nullCase.change_point === null &&
  nullCase.significance_horizon === null &&
  nullCase.data_quality === null &&
  nullCase.tests.seasonal_mk === null &&
  nullCase.tests.annual_mk === null;
console.log(`${nullOk ? "ok   " : "FAIL "} null-SHOULD scenario has every SHOULD field null`);
if (!nullOk) failed += 1;

process.exit(failed ? 1 : 0);
