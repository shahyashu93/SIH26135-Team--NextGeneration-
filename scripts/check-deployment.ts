import "dotenv/config";
import { trustedOrigins } from "../src/server/origin";

const errors: string[] = [];
const environment = process.env;
const vercel = environment.VERCEL === "1";

if (!trustedOrigins().length) errors.push("Set APP_ORIGIN to the public HTTPS origin, or enable Vercel System Environment Variables.");
if (environment.APP_ORIGIN && !trustedOrigins({ APP_ORIGIN: environment.APP_ORIGIN }).length) {
  errors.push("APP_ORIGIN must be an HTTP(S) origin without credentials, a path, query, or fragment.");
}
if (!vercel && !environment.APP_ORIGIN?.startsWith("https://")) {
  errors.push("VPS deployment requires an HTTPS APP_ORIGIN and a TLS reverse proxy.");
}
if (!environment.SESSION_SECRET || environment.SESSION_SECRET.length < 32 || environment.SESSION_SECRET.startsWith("replace-with")) {
  errors.push("SESSION_SECRET must be a random secret of at least 32 characters.");
}
if (!/^[a-f0-9]{64}$/i.test(environment.FIELD_ENCRYPTION_KEY ?? "")) {
  errors.push("FIELD_ENCRYPTION_KEY must contain exactly 64 hexadecimal characters.");
}
for (const name of ["DATABASE_URL", ...(environment.DIRECT_URL ? ["DIRECT_URL"] : [])]) {
  try {
    const url = new URL(environment[name] ?? "");
    if (!["postgres:", "postgresql:"].includes(url.protocol) || !url.hostname || url.pathname.length < 2) throw new Error("Invalid database URL");
    if (vercel && ["localhost", "127.0.0.1", "[::1]", "postgres"].includes(url.hostname)) {
      errors.push(`${name} must point to a hosted database, not the local demo database.`);
    }
    if (url.hostname.endsWith(".pooler.supabase.com") && url.port === "6543") {
      if (name === "DIRECT_URL") errors.push("DIRECT_URL must use Supabase session mode (5432) or a direct connection, not transaction mode (6543).");
      if (name === "DATABASE_URL" && url.searchParams.get("pgbouncer") !== "true") errors.push("Supabase transaction-mode DATABASE_URL requires pgbouncer=true with Prisma 6.");
      if (name === "DATABASE_URL" && !environment.DIRECT_URL) errors.push("Set DIRECT_URL to a session-mode or direct connection for migrations and seeding.");
    }
  } catch { errors.push(`${name} must be a valid PostgreSQL connection URL.`); }
}
if (environment.DEMO_MODE === "true") {
  console.warn("DEMO_MODE is enabled: role access bypasses passwords. Restrict this deployment with platform access protection.");
}
if (errors.length) {
  for (const error of errors) console.error(`Deployment configuration: ${error}`);
  process.exitCode = 1;
} else console.log("Deployment configuration passed. Database connectivity and migrations still require verification.");