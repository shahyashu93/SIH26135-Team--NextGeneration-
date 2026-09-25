import { z } from "zod";
import { NON_PLACEMENT_REASONS } from "./metrics";

export const employmentStatus = z.enum(["SALARIED", "SELF_EMPLOYED", "ENTREPRENEUR", "APPRENTICESHIP", "FREELANCE", "UNEMPLOYED", "EDUCATION"]);
export const consentPurpose = z.enum(["FOLLOWUP", "EMPLOYER_VERIFICATION", "AI_ANALYSIS", "ANALYTICS"]);
export const loginSchema = z.object({ email: z.email(), password: z.string().min(1).max(128) }).strict();
export const demoSchema = z.object({ role: z.enum(["ADMIN", "OFFICER", "PROVIDER", "EMPLOYER", "TRAINEE"]) }).strict();
export const profileSchema = z.object({ location: z.string().trim().min(2).max(100), contact: z.string().trim().min(7).max(80), districtId: z.string().min(1).max(50) }).strict();
export const consentSchema = z.object({ purpose: consentPurpose, granted: z.boolean() }).strict();
export const verificationSchema = z.object({ employmentOk: z.boolean(), roleOk: z.boolean(), salaryOk: z.boolean(), startDateOk: z.boolean() }).strict();
export const employmentSchema = z.object({
  status: employmentStatus,
  employerId: z.string().max(100).optional(),
  role: z.string().trim().min(2).max(100),
  salary: z.number().int().min(0).max(2_000_000).optional(),
  startDate: z.iso.date(),
  reason: z.enum(NON_PLACEMENT_REASONS).optional()
}).strict().superRefine((value, context) => {
  if (new Date(value.startDate) > new Date()) context.addIssue({ code: "custom", message: "Start date cannot be in the future." });
  if (["SALARIED", "APPRENTICESHIP"].includes(value.status) && !value.employerId) context.addIssue({ code: "custom", message: "Choose an employer." });
  if (value.status === "UNEMPLOYED" && !value.reason) context.addIssue({ code: "custom", message: "Choose a non-placement reason." });
});
export const followupSchema = z.object({
  employed: z.boolean(), sameEmployer: z.boolean().optional(), status: employmentStatus.optional(),
  role: z.string().trim().min(2).max(100).optional(), employerId: z.string().max(100).optional(),
  salary: z.number().int().min(0).max(2_000_000).optional(),
  usingSkills: z.boolean().optional(), satisfaction: z.number().int().min(1).max(5).optional(),
  reason: z.enum(NON_PLACEMENT_REASONS).optional(), activelySearching: z.boolean().optional(),
  additionalTraining: z.boolean().optional(), relocation: z.boolean().optional(), education: z.boolean().optional()
}).strict().superRefine((value, context) => {
  if (value.employed && (value.sameEmployer === undefined || value.salary === undefined || !value.role || value.usingSkills === undefined || !value.satisfaction)) context.addIssue({ code: "custom", message: "Complete the employment questions." });
  if (value.employed && !value.sameEmployer && !value.status) context.addIssue({ code: "custom", message: "Choose the new employment type." });
  if (value.employed && !value.sameEmployer && ["SALARIED", "APPRENTICESHIP"].includes(value.status ?? "") && !value.employerId) context.addIssue({ code: "custom", message: "Choose the new employer." });
  if (value.employed && ["UNEMPLOYED", "EDUCATION"].includes(value.status ?? "")) context.addIssue({ code: "custom", message: "Choose a working employment type." });
  if (!value.employed && (!value.reason || value.activelySearching === undefined || value.additionalTraining === undefined || value.relocation === undefined || value.education === undefined)) context.addIssue({ code: "custom", message: "Complete the non-employment questions." });
});
export const traineeSchema = z.object({ name: z.string().trim().min(2).max(100), districtId: z.string().max(50), gender: z.enum(["Woman", "Man", "Other", "Prefer not to say"]), programId: z.string().max(100), cohort: z.string().min(2).max(40) }).strict();
export const programSchema = z.object({ name: z.string().trim().min(3).max(100), sector: z.string().min(2).max(60), duration: z.number().int().min(1).max(2000), modules: z.array(z.string().min(2).max(80)).min(1).max(20), providerId: z.string().min(1).max(100) }).strict();
export const certificationSchema = z.object({ attendance: z.number().min(0).max(100), assessmentScore: z.number().int().min(60).max(100) }).strict();
export const advisorSchema = z.object({ question: z.string().trim().min(8).max(1000), districtId: z.string().max(50).optional() }).strict();