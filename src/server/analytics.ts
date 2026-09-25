import type { Prisma } from "@prisma/client";
import { db } from "./db";
import { allow, type Actor } from "./security";
import { DAY, summarize, WORKING_STATUSES, percentage } from "./metrics";

export type AnalyticsFilters = { districtId?: string; programId?: string; providerId?: string; cohort?: string; gender?: string };
export async function analytics(user: Actor, filters: AnalyticsFilters = {}) {
  allow(user, ["ADMIN", "OFFICER", "PROVIDER"]);
  const enrollmentFilter: Prisma.EnrollmentWhereInput = {
    ...(filters.programId ? { programId: filters.programId } : {}),
    ...(filters.cohort ? { cohort: filters.cohort } : {}),
    ...(user.role === "PROVIDER" ? { providerId: user.providerId ?? "DENIED" } : filters.providerId ? { providerId: filters.providerId } : {})
  };
  const asOf = new Date();
  const trainees = await db.trainee.findMany({ where: {
    consents: { some: { purpose: "ANALYTICS", granted: true } },
    ...(filters.districtId ? { districtId: filters.districtId } : {}),
    ...(filters.gender ? { gender: filters.gender } : {}),
    enrollments: { some: enrollmentFilter }
  }, select: {
    districtId: true, gender: true,
    district: true,
    enrollments: { where: enrollmentFilter, include: { certification: true, program: { select: { id: true, name: true } }, provider: { select: { id: true, name: true } } } },
    employment: { include: { salaries: true, verification: true } },
    followups: { select: { checkpoint: true, completedAt: true, response: true, status: true, dueAt: true } },
    skillGaps: { select: { skill: true, severity: true } }
  } });
  const suppressed = trainees.length > 0 && trainees.length < 5;
  const visible = suppressed ? [] : trainees;
  const metrics = summarize(visible, asOf);
  const districts = await db.district.findMany({ orderBy: { name: "asc" } });
  const districtStats = districts.flatMap(district => {
    const group = visible.filter(trainee => trainee.districtId === district.id);
    if (group.length < 5) return [];
    const result = summarize(group, asOf);
    const gaps = group.flatMap(trainee => trainee.skillGaps.map(gap => gap.skill));
    const topGaps = [...new Set(gaps)].map(skill => ({ skill, count: gaps.filter(gap => gap === skill).length })).filter(gap => gap.count >= 5).sort((left, right) => right.count - left.count).slice(0, 3);
    return [{ ...district, total: result.total, certified: result.certified, placed: result.placed, placementRate: result.placementRate, retention: result.retention[1].rate, averageSalary: result.averageSalary, topGaps }];
  });
  function comparison(kind: "program" | "provider") {
    const items = visible.flatMap(trainee => trainee.enrollments.map(enrollment => enrollment[kind]));
    return [...new Map(items.map(item => [item.id, item])).values()].flatMap(item => {
      const group = visible.filter(trainee => trainee.enrollments.some(enrollment => enrollment[kind].id === item.id));
      if (group.length < 5) return [];
      const result = summarize(group, asOf);
      return [{ ...item, total: result.total, certified: result.certified, certificationRate: percentage(result.certified, result.total), placementRate: result.placementRate, retention: result.retention[1].rate, averageSalary: result.averageSalary, wageGrowth: result.wageGrowth }];
    }).sort((left, right) => right.placementRate - left.placementRate);
  }
  const reasons = visible.flatMap(trainee => {
    const current = trainee.employment.filter(record => !record.endDate && record.startDate <= asOf).sort((left, right) => right.startDate.getTime() - left.startDate.getTime())[0];
    return current && ["UNEMPLOYED", "EDUCATION"].includes(current.status) && current.reason ? [current.reason] : [];
  });
  const nonPlacement = [...new Set(reasons)].map(reason => ({ reason, count: reasons.filter(value => value === reason).length })).filter(reason => reason.count >= 5).sort((left, right) => right.count - left.count);
  const gaps = visible.flatMap(trainee => trainee.skillGaps);
  const skillGaps = [...new Set(gaps.map(gap => gap.skill))].map(skill => ({ skill, high: gaps.filter(gap => gap.skill === skill && gap.severity === "High").length, medium: gaps.filter(gap => gap.skill === skill && gap.severity === "Medium").length, count: gaps.filter(gap => gap.skill === skill).length })).filter(gap => gap.count >= 5).sort((left, right) => right.count - left.count).slice(0, 6);
  const trend = Array.from({ length: 6 }, (_, index) => {
    const date = new Date(asOf.getFullYear(), asOf.getMonth() - (5 - index) + 1, 0, 23, 59, 59);
    const atDate = date > asOf ? asOf : date;
    const eligible = visible.filter(trainee => trainee.enrollments.some(enrollment => enrollment.enrolledAt <= atDate));
    const result = summarize(eligible, atDate);
    return { month: atDate.toLocaleDateString("en-IN", { month: "short" }), employed: result.employed, placed: result.placed, placementRate: result.placementRate };
  });
  const wages = [0, 90, 180, 365].map(days => {
    const values = visible.flatMap(trainee => {
      const record = trainee.employment.filter(item => WORKING_STATUSES.includes(item.status)).sort((left, right) => left.startDate.getTime() - right.startDate.getTime())[0];
      if (!record) return [];
      const milestone = new Date(record.startDate.getTime() + days * DAY);
      if (milestone > asOf) return [];
      const salary = record.salaries.filter(item => item.recordedAt <= asOf && Math.abs(item.recordedAt.getTime() - milestone.getTime()) <= 30 * DAY).sort((left, right) => Math.abs(left.recordedAt.getTime() - milestone.getTime()) - Math.abs(right.recordedAt.getTime() - milestone.getTime()))[0];
      return salary ? [salary.amount] : [];
    });
    return { month: days === 0 ? "At placement" : `${Math.round(days / 30)} months`, salary: values.length >= 5 ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length) : null, sample: values.length >= 5 ? values.length : 0 };
  });
  const status = WORKING_STATUSES.concat(["UNEMPLOYED", "EDUCATION"]).map(value => ({ status: value, count: visible.filter(trainee => trainee.employment.find(record => !record.endDate)?.status === value).length })).filter(item => item.count >= 5);
  const due = visible.flatMap(trainee => trainee.followups).filter(followup => ["SCHEDULED", "SENT"].includes(followup.status) && followup.dueAt <= asOf).length;
  const completed = visible.flatMap(trainee => trainee.followups).filter(followup => followup.status === "COMPLETED").length;
  return {
    synthetic: true, asOf: asOf.toISOString(), suppressed, metrics, districts: districtStats,
    courses: comparison("program"), providers: comparison("provider"), nonPlacement, skillGaps, trend, wages, status,
    followups: { due, completed },
    cohorts: [...new Set(visible.flatMap(trainee => trainee.enrollments.map(enrollment => enrollment.cohort)))].sort(),
    methodology: "Synthetic, consented cohort. Placement = ever placed / certified trainees. Retention = confirmed same-employer outcomes / all first-placement records old enough for the checkpoint; unknown outcomes are not counted as retained. Checkpoints are scheduled after certification, while retention maturity is measured after first placement. Wages are self-reported monthly INR; growth uses paired observations within the current job. Groups below 5 are suppressed. Comparisons are descriptive, not causal impact estimates."
  };
}
export type Analytics = Awaited<ReturnType<typeof analytics>>;