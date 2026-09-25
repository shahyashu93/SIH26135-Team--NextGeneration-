import "dotenv/config";
import EmbeddedPostgres from "embedded-postgres";
import { existsSync } from "node:fs";

async function main() {
  const url = new URL(process.env.DATABASE_URL!);
  if (!["localhost", "127.0.0.1"].includes(url.hostname)) throw new Error("Local launcher only supports a loopback database.");
  const postgres = new EmbeddedPostgres({
    databaseDir: ".local/postgres", user: url.username, password: decodeURIComponent(url.password),
    port: Number(url.port), persistent: true, authMethod: "scram-sha-256",
    postgresFlags: ["-h", "127.0.0.1"],
    onLog: () => undefined, onError: message => console.error(String(message))
  });
  if (!existsSync(".local/postgres/PG_VERSION")) await postgres.initialise();
  await postgres.start();
  const client = postgres.getPgClient();
  await client.connect();
  const database = url.pathname.slice(1);
  const existing = await client.query("SELECT 1 FROM pg_database WHERE datname = $1", [database]);
  await client.end();
  if (!existing.rowCount) await postgres.createDatabase(database);
  console.log(`Local PostgreSQL ready on 127.0.0.1:${url.port}. Keep this process running.`);
  const stop = async () => { await postgres.stop(); process.exit(0); };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  setInterval(() => undefined, 60_000);
}
main().catch(error => { console.error(error); process.exit(1); });