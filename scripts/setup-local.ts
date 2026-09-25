import { randomBytes } from "node:crypto";
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { parse } from "dotenv";

if (existsSync(".env")) {
  if (!parse(readFileSync(".env")).POSTGRES_PASSWORD) {
    appendFileSync(".env", `\nPOSTGRES_PASSWORD=${randomBytes(24).toString("hex")}\n`);
    console.log("Added a generated Docker database password. All existing configuration preserved.");
  } else console.log("Existing .env preserved.");
} else {
  const password = randomBytes(24).toString("hex");
  writeFileSync(".env", [
    `DATABASE_URL=postgresql://skillpulse:${password}@localhost:54329/skillpulse?schema=public`,
    `POSTGRES_PASSWORD=${password}`,
    "REDIS_URL=redis://localhost:6379",
    `SESSION_SECRET=${randomBytes(32).toString("hex")}`,
    `FIELD_ENCRYPTION_KEY=${randomBytes(32).toString("hex")}`,
    "APP_ORIGIN=http://localhost:3000",
    "DEMO_MODE=true",
    `DEMO_PASSWORD=${randomBytes(18).toString("base64url")}`,
    "AI_BASE_URL=",
    "AI_API_KEY=",
    "AI_MODEL=GPT-6-astra",
    ""
  ].join("\n"), { flag: "wx", mode: 0o600 });
  console.log("Generated .env with unique local secrets. Secrets have not been printed.");
}