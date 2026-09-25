import { randomInt } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "./db";
import { ApiError, allow, assertTrainee, encryptContact, type Actor } from "./security";
import { CHECKPOINTS, DAY, WORKING_STATUSES, verificationScore } from "./metrics";
import { certificationSchema, consentSchema, employmentSchema, followupSchema, profileSchema, traineeSchema, verificationSchema } from "./contracts";

type Transaction = Prisma.TransactionClient;
async function lock(transaction: Transaction, id: string) {
  await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${id}))`;
}
async function requireConsent(transaction: Transaction, traineeId: string, purpose: string) {
  const consent = await transaction.consent.findUnique({ where: { traineeId_purpose: { traineeId, purpose } } });
  if (!consent?.granted) throw new ApiError(409, `The trainee has not granted ${purpose.toLowerCase().replaceAll("_", " ")} consent.`);
}
async function recordEvent(transaction: Transaction, user: Actor, traineeId: string, type: string, label: string, payload: Prisma.InputJsonObject = {}) {
  await transaction.outcomeEvent.create({ data: { traineeId, type, label, payload, actorId: user.id } });
  await transaction.auditLog.create({ data: { actorId: user.id, action: type, entityId: traineeId, details: {} } });
}
export async function updateContact(user: Actor, id: string, input: z.infer<typeof profileSchema>) {
  allow(user, ["TRAINEE"]);
  await assertTrainee(user, id);
  return db.$transaction(async transaction => {
    await lock(transaction, id);
    await transaction.trainee.update({ where: { id }, data: { location: input.location, districtId: input.districtId, contactEncrypted: encryptContact(input.contact) } });
    await recordEvent(transaction, user, id, "CONTACT_UPDATED", "Contact and location updated; SkillID unchanged");
    return { ok: true };
  });
}
export async function updateConsent(user: Actor, id: string, input: z.infer<typeof consentSchema>) {
  allow(user, ["TRAINEE"]);
  await assertTrainee(user, id);
  return db.$transaction(async transaction => {
    await lock(transaction, id);
    await transaction.consent.upsert({ where: { traineeId_purpose: { traineeId: id, purpose: input.purpose } }, create: { traineeId: id, ...input }, update: { granted: input.granted } });
    if (input.purpose === "FOLLOWUP") await transaction.followup.updateMany({ where: { traineeId: id, status: { in: input.granted ? ["CANCELLED"] : ["SCHEDULED", "SENT"] } }, data: { status: input.granted ? "SCHEDULED" : "CANCELLED" } });
    if (input.purpose === "AI_ANALYSIS" && !input.granted) await transaction.skillGap.deleteMany({ where: { traineeId: id } });
    await recordEvent(transaction, user, id, "CONSENT_UPDATED", `${input.purpose.replaceAll("_", " ")} consent ${input.granted ? "granted" : "withdrawn"}`, input);
    return { ok: true };
  });
}
async function createEmployment(transaction: Transaction, user: Actor, id: string, input: z.infer<typeof employmentSchema>, now = new Date()) {
  const startDate = new Date(input.startDate);
  const current = await transaction.employmentRecord.findFirst({ where: { traineeId: id, endDate: null }, orderBy: { startDate: "desc" } });
  if (current && startDate < current.startDate) throw new ApiError(409, "New employment cannot start before the current record. Ask your provider to reconcile historical records.");
  if (current) await transaction.employmentRecord.update({ where: { id: current.id }, data: { endDate: startDate } });
  const working = WORKING_STATUSES.includes(input.status);
  const employerId = working && input.employerId ? input.employerId : null;
  if (employerId && !await transaction.employer.findUnique({ where: { id: employerId } })) throw new ApiError(400, "Employer not found.");
  const verificationConsent = await transaction.consent.findUnique({ where: { traineeId_purpose: { traineeId: id, purpose: "EMPLOYER_VERIFICATION" } } });
  const employment = await transaction.employmentRecord.create({ data: {
    traineeId: id, status: input.status, role: input.role, employerId, startDate, reason: input.reason,
    salaries: working && input.salary !== undefined ? { create: { amount: input.salary, recordedAt: now, source: "SELF_REPORTED" } } : undefined,
    verification: employerId && verificationConsent?.granted ? { create: {} } : undefined
  } });
  await recordEvent(transaction, user, id, working ? "PLACEMENT_REPORTED" : "OUTCOME_UPDATED", working ? `Reported ${input.status.toLowerCase().replaceAll("_", " ")}` : `Outcome: ${input.status.toLowerCase()}`, { employmentId: employment.id, status: input.status });
  return employment;
}
export async function reportEmployment(user: Actor, id: string, input: z.infer<typeof employmentSchema>) {
  allow(user, ["ADMIN", "PROVIDER", "TRAINEE"]);
  await assertTrainee(user, id);
  return db.$transaction(async transaction => { await lock(transaction, id); return createEmployment(transaction, user, id, input); });
}
export async function requestVerification(user: Actor, id: string) {
  await assertTrainee(user, id);
  return db.$transaction(async transaction => {
    await lock(transaction, id);
    await requireConsent(transaction, id, "EMPLOYER_VERIFICATION");
    const employment = await transaction.employmentRecord.findFirst({ where: { traineeId: id, endDate: null, employerId: { not: null } }, orderBy: { startDate: "desc" } });
    if (!employment) throw new ApiError(409, "No current employer-linked placement to verify.");
    const request = await transaction.employerVerification.upsert({ where: { employmentId: employment.id }, create: { employmentId: employment.id }, update: {} });
    await recordEvent(transaction, user, id, "VERIFICATION_REQUESTED", "Employer verification requested");
    return request;
  });
}
export async function verifyEmployment(user: Actor, verificationId: string, input: z.infer<typeof verificationSchema>) {
  allow(user, ["EMPLOYER"]);
  return db.$transaction(async transaction => {
    const request = await transaction.employerVerification.findFirst({ where: { id: verificationId, employment: { employerId: user.employerId ?? "DENIED" } }, include: { employment: true } });
    if (!request) throw new ApiError(404, "Verification request not found.");
    await lock(transaction, request.employment.traineeId);
    await requireConsent(transaction, request.employment.traineeId, "EMPLOYER_VERIFICATION");
    const score = verificationScore(Object.values(input));
    const changed = await transaction.employerVerification.updateMany({ where: { id: verificationId, status: "PENDING" }, data: { ...input, score, status: score === 100 ? "VERIFIED" : "DISPUTED", verifiedAt: new Date(), verifiedBy: user.id } });
    if (!changed.count) throw new ApiError(409, "This request has already been reviewed.");
    await recordEvent(transaction, user, request.employment.traineeId, "EMPLOYER_VERIFIED", score === 100 ? "Employment confirmed by employer" : "Employer flagged a discrepancy", { score, ...input });
    return { ok: true, score };
  });
}
export async function completeFollowup(user: Actor, followupId: string, input: z.infer<typeof followupSchema>) {
  allow(user, ["TRAINEE"]);
  return db.$transaction(async transaction => {
    const followup = await transaction.followup.findFirst({ where: { id: followupId, traineeId: user.traineeId ?? "DENIED" } });
    if (!followup) throw new ApiError(404, "Follow-up not found.");
    await lock(transaction, followup.traineeId);
    await requireConsent(transaction, followup.traineeId, "FOLLOWUP");
    const now = new Date();
    if (followup.dueAt > now) throw new ApiError(409, "This follow-up is not due yet.");
    const changed = await transaction.followup.updateMany({ where: { id: followupId, status: { in: ["SCHEDULED", "SENT"] } }, data: { status: "COMPLETED", completedAt: now, response: input } });
    if (!changed.count) throw new ApiError(409, "This follow-up has already been completed or cancelled.");
    const current = await transaction.employmentRecord.findFirst({ where: { traineeId: followup.traineeId, endDate: null }, orderBy: { startDate: "desc" } });
    if (input.employed && input.sameEmployer) {
      if (!current || !WORKING_STATUSES.includes(current.status)) throw new ApiError(409, "Record your current employment before confirming the same employer.");
      if (input.salary !== undefined) await transaction.salaryObservation.create({ data: { employmentId: current.id, amount: input.salary, recordedAt: now, source: "FOLLOWUP" } });
      if (input.role && input.role !== current.role) {
        await transaction.employmentRecord.update({ where: { id: current.id }, data: { role: input.role } });
        await transaction.employerVerification.updateMany({ where: { employmentId: current.id }, data: { status: "PENDING", roleOk: false, score: 0, verifiedAt: null } });
      }
    } else {
      await createEmployment(transaction, user, followup.traineeId, { status: input.employed ? input.status! : input.education ? "EDUCATION" : "UNEMPLOYED", role: input.employed ? input.role! : "Seeking next opportunity", employerId: input.employerId, salary: input.salary, reason: input.reason, startDate: now.toISOString() }, now);
    }
    await recordEvent(transaction, user, followup.traineeId, "FOLLOWUP_COMPLETED", `${followup.checkpoint}-day outcome recorded`, { checkpoint: followup.checkpoint, ...input });
    if (input.employed && input.salary !== undefined) await recordEvent(transaction, user, followup.traineeId, "WAGE_RECORDED", "New wage observation recorded", { amount: input.salary, source: "SELF_REPORTED" });
    return { ok: true };
  });
}
export async function initiateFollowups(user: Actor, id: string) {
  allow(user, ["ADMIN", "PROVIDER"]);
  await assertTrainee(user, id);
  return db.$transaction(async transaction => {
    await lock(transaction, id);
    await requireConsent(transaction, id, "FOLLOWUP");
    const followups = await transaction.followup.findMany({ where: { traineeId: id, status: "SCHEDULED", dueAt: { lte: new Date() } } });
    const recipient = await transaction.user.findUnique({ where: { traineeId: id } });
    if (!recipient) throw new ApiError(409, "The trainee has no portal account yet.");
    for (const followup of followups) {
      await transaction.notification.upsert({ where: { dedupeKey: `followup-${followup.id}` }, create: { userId: recipient.id, title: `${followup.checkpoint}-day check-in`, body: "Your next outcome check-in is ready.", dedupeKey: `followup-${followup.id}` }, update: {} });
      await transaction.followup.update({ where: { id: followup.id }, data: { status: "SENT" } });
    }
    await recordEvent(transaction, user, id, "FOLLOWUP_INITIATED", `${followups.length} due follow-up notification(s) delivered`);
    return { sent: followups.length };
  });
}
export async function enrollTrainee(user: Actor, input: z.infer<typeof traineeSchema>) {
  allow(user, ["ADMIN", "PROVIDER"]);
  const program = await db.trainingProgram.findFirst({ where: { id: input.programId, ...(user.role === "PROVIDER" ? { providerId: user.providerId ?? "DENIED" } : {}) } });
  if (!program) throw new ApiError(404, "Training programme not found.");
  return db.$transaction(async transaction => {
    await lock(transaction, "skill-id-allocation");
    let skillId: string;
    do { skillId = `MH-SK-2026-${String(randomInt(1, 1_000_000)).padStart(6, "0")}`; } while (await transaction.trainee.findUnique({ where: { skillId } }));
    const trainee = await transaction.trainee.create({ data: { skillId, name: input.name, districtId: input.districtId, gender: input.gender, location: "Not provided", skills: [], enrollments: { create: { programId: program.id, providerId: program.providerId, cohort: input.cohort, enrolledAt: new Date(), attendance: 0 } }, consents: { create: ["FOLLOWUP", "ANALYTICS", "AI_ANALYSIS", "EMPLOYER_VERIFICATION"].map(purpose => ({ purpose, granted: false })) } } });
    await recordEvent(transaction, user, trainee.id, "ENROLLED", `Enrolled in ${program.name}`);
    return { id: trainee.id, skillId };
  });
}
export async function certifyTrainee(user: Actor, id: string, input: z.infer<typeof certificationSchema>) {
  allow(user, ["ADMIN", "PROVIDER"]);
  await assertTrainee(user, id);
  if (input.attendance < 75) throw new ApiError(400, "At least 75% attendance is required for certification.");
  return db.$transaction(async transaction => {
    await lock(transaction, id);
    const enrollment = await transaction.enrollment.findFirst({ where: { traineeId: id, certification: null, ...(user.role === "PROVIDER" ? { providerId: user.providerId ?? "DENIED" } : {}) }, orderBy: { enrolledAt: "desc" } });
    if (!enrollment) throw new ApiError(409, "No uncertified enrollment is available.");
    const issuedAt = new Date();
    await transaction.enrollment.update({ where: { id: enrollment.id }, data: { attendance: input.attendance, completedAt: issuedAt, assessments: { create: { skill: "Final competency assessment", score: input.assessmentScore, assessedAt: issuedAt } }, certification: { create: { issuedAt, certificate: `MH-CERT-${enrollment.id}` } } } });
    const consent = await transaction.consent.findUnique({ where: { traineeId_purpose: { traineeId: id, purpose: "FOLLOWUP" } } });
    await transaction.followup.createMany({ data: CHECKPOINTS.map(checkpoint => ({ traineeId: id, checkpoint, dueAt: new Date(issuedAt.getTime() + checkpoint * DAY), status: consent?.granted ? "SCHEDULED" : "CANCELLED" })), skipDuplicates: true });
    await recordEvent(transaction, user, id, "TRAINING_COMPLETED", "Training completed");
    await recordEvent(transaction, user, id, "CERTIFIED", "Certification issued; outcome checkpoints scheduled");
    return { ok: true };
  });
}