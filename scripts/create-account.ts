import "dotenv/config";
import { randomBytes } from "node:crypto";
import { hash } from "bcryptjs";
import { PrismaClient } from "@prisma/client";
import { z } from "zod";

async function main() {
  const [skillId, emailInput] = process.argv.slice(2);
  if (!skillId || skillId === "--help" || !emailInput) {
    console.log("Usage: npm run account:create -- MH-SK-2026-XXXXXX trainee@example.invalid");
    console.log("Local synthetic-demo operator command. Prints a newly generated password once; does not change consent.");
    return;
  }
  if (process.env.DEMO_MODE !== "true") throw new Error("This provisioning command is restricted to the synthetic demo.");
  const email = z.email().parse(emailInput.toLowerCase());
  const password = randomBytes(24).toString("base64url");
  const database = new PrismaClient();
  try {
    const passwordHash = await hash(password, 12);
    await database.$transaction(async transaction => {
      const trainee = await transaction.trainee.findUniqueOrThrow({ where: { skillId }, include: { user: true } });
      if (trainee.user) throw new Error("This trainee already has an account. Existing credentials were not changed.");
      await transaction.user.create({ data: { email, passwordHash, name: trainee.name, role: "TRAINEE", traineeId: trainee.id } });
      await transaction.auditLog.create({ data: { action: "DEMO_ACCOUNT_PROVISIONED", entityId: trainee.id, details: { channel: "LOCAL_OPERATOR" } } });
    });
    console.log(`Created login for ${skillId}. Deliver these credentials privately to the synthetic trainee operator.`);
    console.log(`Email: ${email}\nPassword: ${password}`);
  } finally { await database.$disconnect(); }
}
main().catch(error => { console.error(error instanceof Error ? error.message : "Account creation failed."); process.exitCode = 1; });