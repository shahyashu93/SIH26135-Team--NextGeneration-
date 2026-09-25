export const CHECKPOINTS = [30, 90, 180, 365] as const;
export const WORKING_STATUSES = ["SALARIED", "SELF_EMPLOYED", "ENTREPRENEUR", "APPRENTICESHIP", "FREELANCE"];
export const NON_PLACEMENT_REASONS = ["Technical skill gap", "Soft-skill gap", "Salary mismatch", "Relocation", "Lack of local demand", "Continuing education", "Personal reasons", "Insufficient work experience", "Other"] as const;
export const DAY = 86_400_000;
export const percentage = (numerator: number, denominator: number) => denominator ? Math.round(numerator / denominator * 1000) / 10 : 0;
export const wageGrowth = (initial: number, latest: number) => initial > 0 ? percentage(latest - initial, initial) : null;
export const verificationScore = (checks: boolean[]) => percentage(checks.filter(Boolean).length, checks.length);

export type MetricEmployment = {
  status: string;
  startDate: Date;
  endDate: Date | null;
  salaries: { amount: number; recordedAt: Date }[];
  verification: { status: string } | null;
};
export type MetricTrainee = {
  employment: MetricEmployment[];
  enrollments: { certification: { issuedAt: Date } | null }[];
  followups: { checkpoint: number; completedAt: Date | null; response: unknown }[];
};

export function summarize(trainees: MetricTrainee[], asOf = new Date()) {
  const certified = trainees.filter(trainee => trainee.enrollments.some(enrollment => enrollment.certification && enrollment.certification.issuedAt <= asOf));
  const current = (trainee: MetricTrainee) => trainee.employment.filter(record => record.startDate <= asOf && (!record.endDate || record.endDate > asOf)).sort((left, right) => right.startDate.getTime() - left.startDate.getTime())[0];
  const employed = trainees.filter(trainee => { const record = current(trainee); return record && WORKING_STATUSES.includes(record.status); });
  const placed = certified.filter(trainee => trainee.employment.some(record => WORKING_STATUSES.includes(record.status) && record.startDate <= asOf));
  const salaries = employed.map(trainee => current(trainee)?.salaries.filter(salary => salary.recordedAt <= asOf).sort((left, right) => right.recordedAt.getTime() - left.recordedAt.getTime())[0]?.amount).filter((salary): salary is number => salary !== undefined);
  const growth = employed.flatMap(trainee => {
    const observations = current(trainee)?.salaries.filter(salary => salary.recordedAt <= asOf).sort((left, right) => left.recordedAt.getTime() - right.recordedAt.getTime()) ?? [];
    if (observations.length < 2) return [];
    const value = wageGrowth(observations[0].amount, observations.at(-1)!.amount);
    return value === null ? [] : [value];
  });
  const retention = CHECKPOINTS.map(days => {
    let eligible = 0;
    let retained = 0;
    let observed = 0;
    for (const trainee of trainees) {
      const first = trainee.employment.filter(record => WORKING_STATUSES.includes(record.status) && record.startDate <= asOf).sort((left, right) => left.startDate.getTime() - right.startDate.getTime())[0];
      if (!first) continue;
      const milestone = new Date(first.startDate.getTime() + days * DAY);
      if (milestone > asOf) continue;
      eligible++;
      const evidence = trainee.followups.find(followup => followup.checkpoint === days && followup.completedAt && followup.completedAt >= milestone && followup.completedAt <= asOf);
      const response = evidence?.response as { employed?: boolean; sameEmployer?: boolean } | undefined;
      if (evidence || (first.endDate && first.endDate <= milestone)) observed++;
      if ((!first.endDate || first.endDate > milestone) && response?.employed === true && response.sameEmployer === true) retained++;
    }
    return { day: `${days} days`, days, eligible, retained, observed, rate: percentage(retained, eligible), coverage: percentage(observed, eligible) };
  });
  return {
    total: trainees.length, certified: certified.length, employed: employed.length, placed: placed.length,
    placementRate: percentage(placed.length, certified.length),
    verified: employed.filter(trainee => current(trainee)?.verification?.status === "VERIFIED").length,
    averageSalary: salaries.length ? Math.round(salaries.reduce((sum, salary) => sum + salary, 0) / salaries.length) : 0,
    salarySample: salaries.length,
    wageGrowth: growth.length ? Math.round(growth.reduce((sum, value) => sum + value, 0) / growth.length * 10) / 10 : null,
    wageSample: growth.length, retention
  };
}