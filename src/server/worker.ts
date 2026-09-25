import "dotenv/config";
import { Queue, Worker } from "bullmq";
import IORedis from "ioredis";
import { db } from "./db";

async function main() {
  if (!process.env.REDIS_URL) throw new Error("REDIS_URL is required for the follow-up worker.");
  const connection = new IORedis(process.env.REDIS_URL, { maxRetriesPerRequest: null });
  const queue = new Queue("skillpulse-followups", { connection });
  await queue.upsertJobScheduler("due-followup-reconciler", { every: 60_000 }, { name: "reconcile", data: {} });
  const worker = new Worker("skillpulse-followups", async job => {
    if (job.name === "reconcile") {
      const due = await db.followup.findMany({ where: { status: "SCHEDULED", dueAt: { lte: new Date() } }, take: 200, orderBy: { dueAt: "asc" } });
      await queue.addBulk(due.map(followup => ({ name: "deliver", data: { id: followup.id }, opts: { jobId: `followup-${followup.id}`, attempts: 5, backoff: { type: "exponential", delay: 2000 }, removeOnComplete: true, removeOnFail: 100 } })));
      return;
    }
    await db.$transaction(async transaction => {
      const followup = await transaction.followup.findUnique({ where: { id: String(job.data.id) } });
      if (!followup || followup.status !== "SCHEDULED" || followup.dueAt > new Date()) return;
      await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${followup.traineeId}))`;
      const consent = await transaction.consent.findUnique({ where: { traineeId_purpose: { traineeId: followup.traineeId, purpose: "FOLLOWUP" } } });
      if (!consent?.granted) {
        await transaction.followup.updateMany({ where: { id: followup.id, status: "SCHEDULED" }, data: { status: "CANCELLED" } });
        return;
      }
      const recipient = await transaction.user.findUnique({ where: { traineeId: followup.traineeId } });
      if (!recipient) return;
      const changed = await transaction.followup.updateMany({ where: { id: followup.id, status: "SCHEDULED" }, data: { status: "SENT" } });
      if (!changed.count) return;
      await transaction.notification.upsert({ where: { dedupeKey: `followup-${followup.id}` }, create: { userId: recipient.id, title: `${followup.checkpoint}-day outcome check-in`, body: "Your employment outcome check-in is ready in your trainee portal.", dedupeKey: `followup-${followup.id}` }, update: {} });
      await transaction.auditLog.create({ data: { action: "FOLLOWUP_DELIVERED", entityId: followup.id, details: { channel: "IN_APP" } } });
    });
  }, { connection, concurrency: 5 });
  worker.on("failed", (job, error) => console.error("Follow-up job failed", job?.id, error.name));
  console.log("Follow-up worker ready. Reconciles due checkpoints every 60 seconds; delivery is in-app only.");
  const stop = async () => { await worker.close(); await queue.close(); await connection.quit(); await db.$disconnect(); process.exit(0); };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}
main().catch(error => { console.error(error); process.exit(1); });