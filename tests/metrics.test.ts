import test from "node:test";
import assert from "node:assert/strict";
import { DAY, summarize, wageGrowth, verificationScore, type MetricTrainee } from "../src/server/metrics";

const start = new Date("2026-01-01T00:00:00Z");
const asOf = new Date(start.getTime() + 100 * DAY);
function trainee(age: number, ended = false, observed = true): MetricTrainee {
  const employmentStart = new Date(asOf.getTime() - age * DAY);
  return {
    enrollments: [{ certification: { issuedAt: employmentStart } }],
    employment: [{ status: "SALARIED", startDate: employmentStart, endDate: ended ? new Date(employmentStart.getTime() + 40 * DAY) : null, salaries: [{ amount: 15000, recordedAt: employmentStart }, { amount: 18000, recordedAt: asOf }], verification: { status: "VERIFIED" } }],
    followups: observed ? [{ checkpoint: 90, completedAt: new Date(employmentStart.getTime() + 90 * DAY), response: { employed: true, sameEmployer: true } }] : []
  };
}
test("wage growth uses paired salary observations and handles zero baseline", () => {
  assert.equal(wageGrowth(15000, 18000), 20);
  assert.equal(wageGrowth(0, 18000), null);
  assert.equal(wageGrowth(20000, 18000), -10);
});
test("retention excludes immature cohorts and does not infer missing responses", () => {
  const result = summarize([trainee(100), trainee(100, true), trainee(20), trainee(100, false, false)], asOf);
  assert.equal(result.retention[1].eligible, 3);
  assert.equal(result.retention[1].retained, 1);
  assert.equal(result.retention[1].observed, 2);
  assert.equal(result.retention[1].rate, 33.3);
  assert.equal(result.retention[3].eligible, 0);
});
test("verification requires all checks for a full score", () => {
  assert.equal(verificationScore([true, true, false, true]), 75);
  assert.equal(verificationScore([true, true, true, true]), 100);
});
test("empty cohort is well-defined and has no wage-growth estimate", () => {
  const result = summarize([], asOf);
  assert.equal(result.placementRate, 0);
  assert.equal(result.averageSalary, 0);
  assert.equal(result.wageGrowth, null);
});
test("future salary observations and placements are excluded", () => {
  const result = summarize([trainee(-10)], asOf);
  assert.equal(result.employed, 0);
  assert.equal(result.placed, 0);
});