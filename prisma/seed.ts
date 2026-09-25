import "dotenv/config";
import { PrismaClient, type EmploymentStatus, type Role, type Prisma } from "@prisma/client";
import { hash } from "bcryptjs";
import { CHECKPOINTS, DAY, NON_PLACEMENT_REASONS } from "../src/server/metrics";

const db = new PrismaClient(process.env.DIRECT_URL ? { datasourceUrl: process.env.DIRECT_URL } : undefined);
const districts: [string, number, number][] = [
  ["Pune",18.52,73.86], ["Mumbai City",18.94,72.83], ["Mumbai Suburban",19.12,72.89], ["Thane",19.22,72.98], ["Palghar",19.69,72.77], ["Raigad",18.52,73.18], ["Ratnagiri",16.99,73.31], ["Sindhudurg",16.35,73.56],
  ["Nashik",20.00,73.79], ["Dhule",20.90,74.78], ["Nandurbar",21.37,74.24], ["Jalgaon",21.01,75.56], ["Ahilyanagar",19.10,74.74], ["Satara",17.68,74.00], ["Sangli",16.85,74.58], ["Solapur",17.66,75.91], ["Kolhapur",16.71,74.24],
  ["Chhatrapati Sambhajinagar",19.88,75.34], ["Jalna",19.84,75.89], ["Beed",18.99,75.76], ["Dharashiv",18.18,76.04], ["Latur",18.40,76.58], ["Nanded",19.14,77.32], ["Parbhani",19.26,76.77], ["Hingoli",19.72,77.15],
  ["Amravati",20.94,77.78], ["Akola",20.70,77.00], ["Washim",20.11,77.13], ["Buldhana",20.53,76.18], ["Yavatmal",20.39,78.13], ["Nagpur",21.15,79.09], ["Wardha",20.75,78.60], ["Bhandara",21.17,79.65], ["Gondia",21.46,80.20], ["Chandrapur",19.96,79.30], ["Gadchiroli",20.18,80.00]
];
const programs = [
  { name: "Solar PV Installer", sector: "Renewable energy", modules: ["Electrical safety", "PV installation", "Advanced Troubleshooting"] },
  { name: "CNC Machine Operator", sector: "Manufacturing", modules: ["Machine setup", "Quality inspection", "CNC programming"] },
  { name: "Healthcare Assistant", sector: "Healthcare", modules: ["Patient care", "Clinical records", "Communication"] },
  { name: "Web Application Developer", sector: "IT & ITeS", modules: ["JavaScript", "Database design", "API testing"] },
  { name: "Retail Sales Associate", sector: "Retail", modules: ["Customer service", "Inventory systems", "Communication"] },
  { name: "Electric Vehicle Technician", sector: "Automotive", modules: ["Electrical safety", "Battery diagnostics", "Advanced Troubleshooting"] },
  { name: "Logistics Coordinator", sector: "Logistics", modules: ["Warehouse systems", "Route planning", "Digital literacy"] },
  { name: "Food Processing Technician", sector: "Food processing", modules: ["Food safety", "Quality inspection", "Digital literacy"] }
];
let randomState = 26135;
function random() { randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0; return randomState / 4294967296; }
const ago = (days: number) => new Date(Date.now() - days * DAY);
const firstNames = ["Aarav", "Sneha", "Omkar", "Priya", "Aditya", "Sakshi", "Vishal", "Pooja", "Rohan", "Neha", "Akash", "Aditi"];
const lastNames = ["Deshmukh", "Jadhav", "More", "Shinde", "Pawar", "Kadam", "Chavan", "Bhosale", "Gaikwad", "Kulkarni"];

async function main() {
  if (process.env.DEMO_MODE !== "true") throw new Error("Seeding requires DEMO_MODE=true. Never seed production records.");
  if (!process.env.DEMO_PASSWORD || process.env.DEMO_PASSWORD.length < 12) throw new Error("Set a strong DEMO_PASSWORD before seeding.");
  if (await db.trainee.count()) { console.log("Existing trainees found. Seed skipped to preserve workflow changes."); return; }
  const passwordHash = await hash(process.env.DEMO_PASSWORD, 12);
  await db.$transaction(async transaction => {
    await transaction.district.createMany({ data: districts.map(([name, latitude, longitude], index) => ({ id: `district-${index}`, name, latitude, longitude })) });
    const providerNames = ["Pune Renewable Skills Centre", "Maharashtra Advanced Manufacturing Institute", "Sahyadri Healthcare Academy", "Nagpur Digital Skills Institute", "Konkan Livelihoods Foundation", "Marathwada Technical Centre"];
    await transaction.provider.createMany({ data: providerNames.map((name, index) => ({ id: `provider-${index}`, name, districtId: `district-${[0,8,13,30,5,17][index]}` })) });
    await transaction.trainingProgram.createMany({ data: programs.map((program, index) => ({ id: `program-${index}`, ...program, duration: 240 + index * 40, providerId: `provider-${index % 6}` })) });
    await transaction.employer.createMany({ data: ["SuryaGrid Energy", "Deccan Precision Works", "Sahyadri Care Services", "Vertex Digital Solutions", "MahaMart Retail", "VoltPath Mobility"].map((name, index) => ({ id: `employer-${index}`, name: `${name} (Sandbox)`, sector: programs[index].sector, requirements: programs[index].modules, sandbox: true })) });
    for (let index = 0; index < 720; index++) {
      const isRahul = index === 0;
      const programIndex = isRahul ? 0 : Math.floor(random() * programs.length);
      const program = programs[programIndex];
      const age = isRahul ? 105 : 15 + Math.floor(random() * 470);
      const certified = isRahul || random() > 0.08;
      const hadPlacement = certified && (isRahul || random() > 0.23);
      const attrited = !isRahul && hadPlacement && random() < 0.19;
      const workStatuses: EmploymentStatus[] = ["SALARIED", "SALARIED", "SALARIED", "SELF_EMPLOYED", "ENTREPRENEUR", "APPRENTICESHIP", "FREELANCE"];
      const status: EmploymentStatus = hadPlacement ? isRahul ? "SALARIED" : workStatuses[Math.floor(random() * workStatuses.length)] : random() < 0.2 ? "EDUCATION" : "UNEMPLOYED";
      const employerId = ["SALARIED", "APPRENTICESHIP"].includes(status) ? `employer-${isRahul ? 0 : programIndex % 6}` : null;
      const salary = isRahul ? 15000 : 11000 + Math.floor(random() * 18) * 1000;
      const start = ago(age - 10);
      const leftAfter = 35 + Math.floor(random() * 50);
      const endDate = attrited && age - 10 > leftAfter ? new Date(start.getTime() + leftAfter * DAY) : null;
      const verified = !isRahul && Boolean(employerId) && random() < 0.81;
      const id = isRahul ? "rahul-patil" : `trainee-${index}`;
      const followups = certified ? CHECKPOINTS.map(checkpoint => {
        const dueAt = new Date(ago(age).getTime() + checkpoint * DAY);
        const completedAt = new Date(start.getTime() + (checkpoint + 1) * DAY);
        const completed = completedAt < new Date() && !(isRahul && checkpoint >= 90) && (isRahul || random() < 0.84);
        const employed = hadPlacement && (!endDate || endDate > completedAt);
        return { checkpoint, dueAt, status: completed ? "COMPLETED" as const : "SCHEDULED" as const, completedAt: completed ? completedAt : null, response: completed ? { employed, sameEmployer: employed, role: program.name, salary: employed ? salary + Math.floor(checkpoint / 90) * 1000 : undefined, usingSkills: employed, satisfaction: 4, reason: employed ? undefined : NON_PLACEMENT_REASONS[Math.floor(random() * NON_PLACEMENT_REASONS.length)] } as Prisma.InputJsonObject : undefined };
      }) : [];
      const observations = hadPlacement ? [{ amount: salary, recordedAt: start, source: "SYNTHETIC_SEED" }, ...[90,180,365].filter(days => !isRahul && age - 10 >= days && (!endDate || endDate.getTime() > start.getTime() + days * DAY)).map(days => ({ amount: salary + Math.floor(days / 90) * 1000, recordedAt: new Date(start.getTime() + days * DAY), source: "SYNTHETIC_SEED" }))] : [];
      const assessmentScores = program.modules.map((skill, moduleIndex) => ({ skill, score: isRahul ? moduleIndex === 2 ? 48 : 87 : 40 + Math.floor(random() * 60), assessedAt: ago(age + 2) }));
      const reason = status === "EDUCATION" ? "Continuing education" : NON_PLACEMENT_REASONS[Math.floor(random() * NON_PLACEMENT_REASONS.length)];
      await transaction.trainee.create({ data: {
        id, skillId: `MH-SK-2026-${String(index + 1).padStart(6, "0")}`, name: isRahul ? "Rahul Patil" : `${firstNames[index % firstNames.length]} ${lastNames[Math.floor(index / firstNames.length) % lastNames.length]} ${String(index).padStart(3, "0")}`,
        districtId: `district-${index % districts.length}`, location: districts[index % districts.length][0], gender: isRahul ? "Man" : index % 2 ? "Woman" : "Man", skills: program.modules.slice(0, 2), createdAt: ago(age + 100),
        enrollments: { create: { id: `enrollment-${index}`, programId: `program-${programIndex}`, providerId: `provider-${programIndex % 6}`, cohort: age > 270 ? "2025-26" : "2026-27", enrolledAt: ago(age + 100), completedAt: certified ? ago(age + 2) : null, attendance: 76 + Math.floor(random() * 24), assessments: { create: assessmentScores }, certification: certified ? { create: { certificate: `MH-CERT-2026-${String(index + 1).padStart(6, "0")}`, issuedAt: ago(age) } } : undefined } },
        employment: { create: [
          { id: `employment-${index}`, status, role: hadPlacement ? program.name : "Seeking next opportunity", startDate: start, endDate, employerId, reason: hadPlacement ? null : reason, salaries: { create: observations }, verification: employerId ? { create: { id: `verification-${index}`, status: verified ? "VERIFIED" : "PENDING", employmentOk: verified, roleOk: verified, salaryOk: verified, startDateOk: verified, score: verified ? 100 : 0, verifiedAt: verified ? new Date(start.getTime() + 3 * DAY) : null, verifiedBy: verified ? "synthetic-employer" : null } } : undefined },
          ...(endDate ? [{ status: "UNEMPLOYED" as const, role: "Seeking next opportunity", startDate: endDate, reason }] : [])
        ] },
        followups: { create: followups },
        consents: { create: ["ANALYTICS", "FOLLOWUP", "EMPLOYER_VERIFICATION", "AI_ANALYSIS"].map(purpose => ({ purpose, granted: true })) },
        skillGaps: { create: isRahul ? [] : assessmentScores.filter(assessment => assessment.score < 65).map(assessment => ({ skill: assessment.skill, severity: assessment.score < 55 ? "High" : "Medium", evidence: `Synthetic assessment ${assessment.score}/100; course competency below advisory threshold.`, action: `Recommend targeted ${assessment.skill.toLowerCase()} practice and reassessment.`, source: "Synthetic assessment rules" })) },
        events: { create: [
          { type: "ENROLLED", label: `Enrolled in ${program.name}`, occurredAt: ago(age + 100), payload: { synthetic: true } },
          ...(certified ? [{ type: "TRAINING_COMPLETED", label: "Training completed", occurredAt: ago(age + 2), payload: { synthetic: true } }, { type: "CERTIFIED", label: "Certification issued", occurredAt: ago(age), payload: { synthetic: true } }] : []),
          ...(hadPlacement ? [{ type: "PLACEMENT_REPORTED", label: "Placement reported", occurredAt: start, payload: { synthetic: true } }] : []),
          ...(verified ? [{ type: "EMPLOYER_VERIFIED", label: "Sandbox employer confirmed employment", occurredAt: new Date(start.getTime() + 3 * DAY), payload: { score: 100, synthetic: true } }] : []),
          ...followups.filter(followup => followup.completedAt).map(followup => ({ type: "FOLLOWUP_COMPLETED", label: `${followup.checkpoint}-day outcome recorded`, occurredAt: followup.completedAt!, payload: { checkpoint: followup.checkpoint, synthetic: true } }))
        ] },
        user: { create: { email: isRahul ? "trainee@skillpulse.demo" : `trainee${index}@skillpulse.demo`, passwordHash, name: isRahul ? "Rahul Patil" : `Synthetic trainee ${index}`, role: "TRAINEE" } }
      } });
    }
    const roles: { role: Role; name: string; providerId?: string; employerId?: string }[] = [
      { role: "ADMIN", name: "Platform Administrator" }, { role: "OFFICER", name: "Ananya Deshmukh" },
      { role: "PROVIDER", name: "Pune Skills Coordinator", providerId: "provider-0" }, { role: "EMPLOYER", name: "SuryaGrid Verification Desk", employerId: "employer-0" }
    ];
    await transaction.user.createMany({ data: roles.map(user => ({ ...user, email: `${user.role.toLowerCase()}@skillpulse.demo`, passwordHash })) });
    const rahul = await transaction.user.findUniqueOrThrow({ where: { email: "trainee@skillpulse.demo" } });
    await transaction.notification.create({ data: { userId: rahul.id, title: "Your 90-day check-in is ready", body: "Share your employment update and current monthly income." } });
    await transaction.auditLog.create({ data: { action: "SYNTHETIC_DATA_SEEDED", entityId: "demo-2026", details: { trainees: 720, districts: 36, officialStatistics: false } } });
  }, { timeout: 180_000 });
  console.log("Seeded 720 SYNTHETIC trainees, 36 districts, 8 programmes, 6 providers and 5 demo roles. Rahul is ready for employer verification and 90-day follow-up.");
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => db.$disconnect());