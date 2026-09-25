import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { ZodError } from "zod";
import { db } from "@/server/db";
import { actor, allow, ApiError, assertOrigin, assertTrainee, decryptContact, demoEnabled, login, logout, traineeScope } from "@/server/security";
import { analytics } from "@/server/analytics";
import { advise, analyzeGaps, ruleInsights } from "@/server/ai";
import * as schemas from "@/server/contracts";
import * as workflows from "@/server/workflows";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ path: string[] }> };
const success = (data: unknown, status = 200) => NextResponse.json(data, { status, headers: { "Cache-Control": "no-store" } });
function failure(error: unknown) {
  if (error instanceof ApiError) return success({ error: error.message }, error.status);
  if (error instanceof ZodError) return success({ error: error.issues.map(issue => issue.message).join(" ") }, 400);
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === "P2002") return success({ error: "This record already exists." }, 409);
    if (["P2003", "P2025"].includes(error.code)) return success({ error: "A referenced record was not found." }, 400);
  }
  console.error("API request failed", error instanceof Error ? error.name : "UnknownError");
  return success({ error: "The service is temporarily unavailable. Check database configuration and retry." }, 503);
}
export async function GET(request: NextRequest, context: Context) {
  try {
    const { path } = await context.params;
    const route = path.join("/");
    if (route === "config") return success({ demo: demoEnabled(), synthetic: true });
    if (route === "health") { await db.$queryRaw`SELECT 1`; return success({ status: "ok" }); }
    const user = await actor();
    if (route === "auth/me") return success(user);
    if (route === "notifications") return success(await db.notification.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" }, take: 30 }));
    if (route === "options") {
      const [districts, providers, programs, employers] = await Promise.all([
        db.district.findMany({ orderBy: { name: "asc" } }),
        db.provider.findMany({ where: user.role === "PROVIDER" ? { id: user.providerId ?? "DENIED" } : {}, select: { id: true, name: true } }),
        db.trainingProgram.findMany({ where: user.role === "PROVIDER" ? { providerId: user.providerId ?? "DENIED" } : {}, include: { provider: { select: { name: true } } }, orderBy: { name: "asc" } }),
        db.employer.findMany({ select: { id: true, name: true, sandbox: true } })
      ]);
      return success({ districts, providers, programs, employers });
    }
    if (route === "analytics" || route === "reports") {
      const filters = Object.fromEntries(["districtId", "programId", "providerId", "cohort", "gender"].flatMap(key => { const value = request.nextUrl.searchParams.get(key); return value ? [[key, value.slice(0, 100)]] : []; }));
      const data = await analytics(user, filters);
      if (route === "reports") {
        await db.auditLog.create({ data: { actorId: user.id, action: "REPORT_GENERATED", entityId: "aggregate", details: filters } });
        return success({ ...data, report: { title: "SkillPulse Maharashtra | Outcome Intelligence Report", insights: ruleInsights(data), generatedAt: new Date().toISOString() } });
      }
      return success(data);
    }
    if (route === "trainees") {
      allow(user, ["ADMIN", "PROVIDER"]);
      const page = Math.max(1, Math.min(100_000, Number(request.nextUrl.searchParams.get("page")) || 1));
      const search = (request.nextUrl.searchParams.get("search") ?? "").slice(0, 100);
      const districtId = request.nextUrl.searchParams.get("districtId");
      const where: Prisma.TraineeWhereInput = { AND: [traineeScope(user), ...(districtId ? [{ districtId }] : []), ...(search ? [{ OR: [{ name: { contains: search, mode: "insensitive" as const } }, { skillId: { contains: search, mode: "insensitive" as const } }] }] : [])] };
      const [total, items] = await Promise.all([db.trainee.count({ where }), db.trainee.findMany({ where, orderBy: { skillId: "asc" }, take: 15, skip: (page - 1) * 15, select: { id: true, name: true, skillId: true, district: { select: { name: true } }, enrollments: { take: 1, orderBy: { enrolledAt: "desc" }, select: { program: { select: { name: true } }, cohort: true, certification: { select: { issuedAt: true } } } }, employment: { where: { endDate: null }, take: 1, select: { status: true, verification: { select: { status: true } } } } } })]);
      await db.auditLog.create({ data: { actorId: user.id, action: "TRAINEE_LIST_READ", entityId: "directory", details: { page } } });
      return success({ items, total, page, pageSize: 15 });
    }
    if (path[0] === "trainees" && path.length === 2) {
      const id = path[1] === "me" ? user.traineeId ?? "DENIED" : path[1];
      await assertTrainee(user, id);
      const trainee = await db.trainee.findUniqueOrThrow({ where: { id }, include: { district: true, enrollments: { include: { program: true, provider: true, assessments: true, certification: true } }, employment: { orderBy: { startDate: "desc" }, include: { employer: true, salaries: { orderBy: { recordedAt: "asc" } }, verification: true } }, followups: { orderBy: { checkpoint: "asc" } }, events: { orderBy: { occurredAt: "asc" } }, skillGaps: true, consents: true } });
      const { contactEncrypted, ...profile } = trainee;
      await db.auditLog.create({ data: { actorId: user.id, action: "PROFILE_READ", entityId: id, details: {} } });
      return success({ ...profile, contact: user.role === "TRAINEE" ? decryptContact(contactEncrypted) : undefined });
    }
    if (route === "verifications") {
      allow(user, ["EMPLOYER"]);
      return success(await db.employerVerification.findMany({ where: { employment: { employerId: user.employerId ?? "DENIED", trainee: { consents: { some: { purpose: "EMPLOYER_VERIFICATION", granted: true } } } } }, orderBy: [{ status: "asc" }, { requestedAt: "desc" }], take: 100, select: { id: true, status: true, score: true, requestedAt: true, verifiedAt: true, employment: { select: { role: true, startDate: true, status: true, trainee: { select: { name: true, skillId: true } }, salaries: { orderBy: { recordedAt: "asc" }, take: 1, select: { amount: true } }, employer: { select: { name: true, sandbox: true } } } } } }));
    }
    if (route === "followups") {
      allow(user, ["ADMIN", "PROVIDER", "TRAINEE"]);
      const page = Math.max(1, Number(request.nextUrl.searchParams.get("page")) || 1);
      const where: Prisma.FollowupWhereInput = { trainee: traineeScope(user), status: { in: ["SCHEDULED", "SENT"] } };
      const [total, items] = await Promise.all([db.followup.count({ where }), db.followup.findMany({ where, orderBy: { dueAt: "asc" }, take: 20, skip: (page - 1) * 20, include: { trainee: { select: { id: true, name: true, skillId: true } } } })]);
      return success({ items, total, page, pageSize: 20 });
    }
    if (route === "audit") {
      allow(user, ["ADMIN"]);
      return success(await db.auditLog.findMany({ orderBy: { createdAt: "desc" }, take: 100 }));
    }
    throw new ApiError(404, "Endpoint not found.");
  } catch (error) { return failure(error); }
}
export async function POST(request: NextRequest, context: Context) {
  try {
    assertOrigin(request);
    const text = await request.text();
    if (text.length > 16_384) throw new ApiError(413, "Request body is too large.");
    let body: unknown;
    try { body = JSON.parse(text || "{}"); } catch { throw new ApiError(400, "Invalid JSON request."); }
    const { path } = await context.params;
    const route = path.join("/");
    if (route === "auth/login") { const input = schemas.loginSchema.parse(body); return success(await login(input.email, input.password)); }
    if (route === "auth/demo") { const input = schemas.demoSchema.parse(body); return success(await login("", "", input.role)); }
    const user = await actor();
    if (route === "auth/logout") { await logout(); return success({ ok: true }); }
    if (route === "trainees") return success(await workflows.enrollTrainee(user, schemas.traineeSchema.parse(body)), 201);
    if (route === "programs") {
      allow(user, ["ADMIN", "PROVIDER"]);
      const input = schemas.programSchema.parse(body);
      if (user.role === "PROVIDER" && input.providerId !== user.providerId) throw new ApiError(403, "Provider scope mismatch.");
      return success(await db.$transaction(async transaction => {
        const program = await transaction.trainingProgram.create({ data: input });
        await transaction.auditLog.create({ data: { actorId: user.id, action: "PROGRAM_CREATED", entityId: program.id, details: {} } });
        return program;
      }), 201);
    }
    if (path[0] === "trainees" && path.length === 3) {
      const id = path[1] === "me" ? user.traineeId ?? "DENIED" : path[1];
      if (path[2] === "contact") return success(await workflows.updateContact(user, id, schemas.profileSchema.parse(body)));
      if (path[2] === "consent") return success(await workflows.updateConsent(user, id, schemas.consentSchema.parse(body)));
      if (path[2] === "employment") return success(await workflows.reportEmployment(user, id, schemas.employmentSchema.parse(body)));
      if (path[2] === "verify") return success(await workflows.requestVerification(user, id));
      if (path[2] === "followups") return success(await workflows.initiateFollowups(user, id));
      if (path[2] === "certify") return success(await workflows.certifyTrainee(user, id, schemas.certificationSchema.parse(body)));
      if (path[2] === "gaps") return success(await analyzeGaps(user, id));
    }
    if (path[0] === "verifications" && path.length === 2) return success(await workflows.verifyEmployment(user, path[1], schemas.verificationSchema.parse(body)));
    if (path[0] === "followups" && path.length === 2) return success(await workflows.completeFollowup(user, path[1], schemas.followupSchema.parse(body)));
    if (route === "advisor") { const input = schemas.advisorSchema.parse(body); return success(await advise(user, input.question, input.districtId)); }
    if (route === "notifications/read") { await db.notification.updateMany({ where: { userId: user.id }, data: { read: true } }); return success({ ok: true }); }
    throw new ApiError(404, "Endpoint not found.");
  } catch (error) { return failure(error); }
}