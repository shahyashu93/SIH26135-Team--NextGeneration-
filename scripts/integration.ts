import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { hash } from "bcryptjs";
import { PrismaClient } from "@prisma/client";
import type { Analytics } from "../src/server/analytics";

const database = new PrismaClient();
const origin = process.env.APP_ORIGIN ?? "http://localhost:3000";
const suffix = randomUUID();
const traineeId = `integration-${suffix}`;
const password = randomUUID();
const email = `${suffix}@integration.invalid`;
const daysAgo = (days: number) => new Date(Date.now() - days * 86_400_000);
let checks = 0;
async function request(path: string, cookie = "", body?: unknown, expected = 200, requestOrigin = origin) {
  const response = await fetch(`${origin}/api/${path}`, { method: body === undefined ? "GET" : "POST", headers: { Cookie: cookie, Origin: requestOrigin, "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = await response.json();
  assert.equal(response.status, expected, `${path}: ${JSON.stringify(data)}`);
  checks++;
  return { data, cookie: response.headers.get("set-cookie")?.split(";")[0] ?? "" };
}
async function main() {
  assert.equal(process.env.DEMO_MODE, "true", "Integration checks require the synthetic demo database.");
  await request("health");
  await request("analytics", "", undefined, 401);
  await request("auth/demo", "", { role: "OFFICER" }, 403, "https://untrusted.invalid");
  const provider = (await request("auth/demo", "", { role: "PROVIDER" })).cookie;
  const officer = (await request("auth/demo", "", { role: "OFFICER" })).cookie;
  const employer = (await request("auth/demo", "", { role: "EMPLOYER" })).cookie;
  const other = await database.trainee.findFirstOrThrow({ where: { enrollments: { none: { providerId: "provider-0" } } } });
  await request(`trainees/${other.id}`, provider, undefined, 404);
  await request("trainees/rahul-patil", officer, undefined, 403);
  await request("trainees/rahul-patil", employer, undefined, 403);
  await request("analytics", employer, undefined, 403);
  const foreignVerification = await database.employerVerification.findFirstOrThrow({ where: { employment: { employerId: { not: "employer-0" } } } });
  const confirmation = { employmentOk: true, roleOk: true, salaryOk: true, startDateOk: true };
  await request(`verifications/${foreignVerification.id}`, employer, confirmation, 404);
  await database.trainee.create({ data: {
    id: traineeId, skillId: `TEST-${suffix}`, name: "Integration Fixture", districtId: "district-0", gender: "Other", location: "Pune", skills: [],
    user: { create: { id: traineeId, email, passwordHash: await hash(password, 12), name: "Integration Fixture", role: "TRAINEE" } },
    consents: { create: ["FOLLOWUP", "EMPLOYER_VERIFICATION", "AI_ANALYSIS", "ANALYTICS"].map(purpose => ({ purpose, granted: true })) },
    enrollments: { create: { id: traineeId, programId: "program-0", providerId: "provider-0", cohort: "Integration fixture", enrolledAt: daysAgo(200), completedAt: daysAgo(110), attendance: 95,
      certification: { create: { certificate: traineeId, issuedAt: daysAgo(110) } }, assessments: { create: { skill: "Advanced Troubleshooting", score: 48, assessedAt: daysAgo(110) } } } },
    employment: { create: { id: traineeId, employerId: "employer-0", status: "SALARIED", role: "Solar PV Installer", startDate: daysAgo(100), salaries: { create: { amount: 15000, recordedAt: daysAgo(100), source: "SELF_REPORTED" } }, verification: { create: { id: traineeId } } } },
    followups: { create: [{ id: traineeId, checkpoint: 90, dueAt: daysAgo(20) }, { id: `${traineeId}-future`, checkpoint: 180, dueAt: daysAgo(-70) }] }
  } });
  const trainee = (await request("auth/login", "", { email, password })).cookie;
  await request("trainees/rahul-patil", trainee, undefined, 404);
  await request("analytics", trainee, undefined, 403);
  const before = (await request("analytics", officer)).data as Analytics;
  const original = (await request("trainees/me", trainee)).data;
  await request("trainees/me/contact", trainee, { contact: "fixture@example.invalid", location: "Pune test location", districtId: "district-0" });
  const updated = (await request("trainees/me", trainee)).data;
  assert.equal(updated.skillId, original.skillId);
  assert.equal(updated.contact, "fixture@example.invalid");
  const stored = await database.trainee.findUniqueOrThrow({ where: { id: traineeId } });
  assert.ok(stored.contactEncrypted && !stored.contactEncrypted.includes("fixture@"));
  const providerProfile = (await request(`trainees/${traineeId}`, provider)).data;
  assert.equal(providerProfile.contact, undefined);
  assert.equal(providerProfile.contactEncrypted, undefined);
  await request("trainees/me/consent", trainee, { purpose: "EMPLOYER_VERIFICATION", granted: false });
  await request(`verifications/${traineeId}`, employer, confirmation, 409);
  assert.ok(!(await request("verifications", employer)).data.some((item: { id: string }) => item.id === traineeId));
  await request("trainees/me/consent", trainee, { purpose: "EMPLOYER_VERIFICATION", granted: true });
  await request(`verifications/${traineeId}`, employer, confirmation);
  await request(`verifications/${traineeId}`, employer, confirmation, 409);
  const response = { employed: true, sameEmployer: true, role: "Solar PV Installer", salary: 18000, usingSkills: true, satisfaction: 4 };
  await request(`followups/${traineeId}`, trainee, { ...response, salary: -1 }, 400);
  await request(`followups/${traineeId}-future`, trainee, response, 409);
  await request("trainees/me/consent", trainee, { purpose: "FOLLOWUP", granted: false });
  await request(`followups/${traineeId}`, trainee, response, 409);
  await request("trainees/me/consent", trainee, { purpose: "FOLLOWUP", granted: true });
  await request(`trainees/${traineeId}/followups`, provider, {});
  await request(`trainees/${traineeId}/followups`, provider, {});
  assert.equal(await database.notification.count({ where: { userId: traineeId } }), 1);
  const submissions = await Promise.all([0, 1].map(async () => {
    const result = await fetch(`${origin}/api/followups/${traineeId}`, { method: "POST", headers: { Cookie: trainee, Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify(response) });
    return result.status;
  }));
  assert.deepEqual(submissions.sort(), [200, 409]);
  const after = (await request("analytics", officer)).data as Analytics;
  assert.equal(after.metrics.verified, before.metrics.verified + 1);
  assert.equal(after.metrics.retention.find(item => item.days === 90)!.retained, before.metrics.retention.find(item => item.days === 90)!.retained + 1);
  const history = (await request("trainees/me", trainee)).data;
  assert.deepEqual(history.employment[0].salaries.map((item: { amount: number }) => item.amount), [15000, 18000]);
  assert.equal(history.employment[0].verification.score, 100);
  await database.skillGap.create({ data: { traineeId, skill: "Obsolete fixture gap", severity: "Low", evidence: "Old evidence", action: "Old recommendation", source: "Rules-based assessment evidence" } });
  await request("trainees/me/gaps", trainee, {});
  assert.ok(await database.skillGap.count({ where: { traineeId } }));
  assert.equal(await database.skillGap.count({ where: { traineeId, skill: "Obsolete fixture gap" } }), 0);
  await request("trainees/me/consent", trainee, { purpose: "AI_ANALYSIS", granted: false });
  assert.equal(await database.skillGap.count({ where: { traineeId } }), 0);
  await request("trainees/me/gaps", trainee, {}, 409);
  await request("trainees/me/consent", trainee, { purpose: "ANALYTICS", granted: false });
  assert.equal((await request("analytics", officer)).data.metrics.total, after.metrics.total - 1);
  await database.employmentRecord.update({ where: { id: traineeId }, data: { startDate: new Date() } });
  await database.followup.update({ where: { id: `${traineeId}-future` }, data: { dueAt: daysAgo(1) } });
  await request(`followups/${traineeId}-future`, trainee, { employed: false, reason: "Continuing education", activelySearching: false, additionalTraining: true, relocation: false, education: true });
  const transitioned = (await request("trainees/me", trainee)).data;
  assert.equal(transitioned.employment[0].status, "EDUCATION");
  assert.ok(transitioned.employment[1].endDate);
  await request("auth/logout", trainee, {});
  await request("trainees/me", trainee, undefined, 401);
  console.log(`Passed ${checks} HTTP checks plus ownership, encryption, consent, concurrency, wage history, retention and KPI assertions.`);
}
main().finally(async () => {
  await database.$transaction(async transaction => {
    await transaction.notification.deleteMany({ where: { userId: traineeId } });
    await transaction.user.deleteMany({ where: { id: traineeId } });
    await transaction.auditLog.deleteMany({ where: { OR: [{ actorId: traineeId }, { entityId: traineeId }] } });
    await transaction.outcomeEvent.deleteMany({ where: { traineeId } });
    await transaction.skillGap.deleteMany({ where: { traineeId } });
    await transaction.followup.deleteMany({ where: { traineeId } });
    await transaction.consent.deleteMany({ where: { traineeId } });
    await transaction.employerVerification.deleteMany({ where: { employment: { traineeId } } });
    await transaction.salaryObservation.deleteMany({ where: { employment: { traineeId } } });
    await transaction.employmentRecord.deleteMany({ where: { traineeId } });
    await transaction.certification.deleteMany({ where: { enrollment: { traineeId } } });
    await transaction.assessment.deleteMany({ where: { enrollment: { traineeId } } });
    await transaction.enrollment.deleteMany({ where: { traineeId } });
    await transaction.trainee.deleteMany({ where: { id: traineeId } });
  });
  await database.$disconnect();
}).catch(error => { console.error(error); process.exitCode = 1; });