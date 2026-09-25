import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { isAllowedOrigin, secureSessionCookie, trustedOrigins } from "../src/server/origin";

const vercel = {
  VERCEL: "1", VERCEL_ENV: "production", APP_ORIGIN: "http://localhost:3000",
  VERCEL_URL: "skillpulse-build.vercel.app", VERCEL_BRANCH_URL: "skillpulse-main.vercel.app",
  VERCEL_PROJECT_PRODUCTION_URL: "skillpulse.vercel.app"
};
const request = (origin: string) => new Request("https://internal.invalid/api/auth/login", { headers: { origin } });

test("Vercel accepts exact deployment domains despite stale localhost configuration", () => {
  for (const host of [vercel.VERCEL_URL, vercel.VERCEL_BRANCH_URL, vercel.VERCEL_PROJECT_PRODUCTION_URL]) {
    assert.equal(isAllowedOrigin(request(`https://${host}`), vercel), true);
  }
  assert.equal(isAllowedOrigin(request("http://localhost:3000"), vercel), false);
  assert.equal(isAllowedOrigin(request("https://skillpulse.vercel.app"), { ...vercel, APP_ORIGIN: undefined }), true);
});

test("custom domains and VPS origins must be explicitly configured", () => {
  assert.equal(isAllowedOrigin(request("https://skills.example.org"), { ...vercel, APP_ORIGIN: "https://skills.example.org/" }), true);
  assert.equal(isAllowedOrigin(request("https://skills.example.org"), { APP_ORIGIN: "https://skills.example.org" }), true);
  assert.equal(isAllowedOrigin(request("http://localhost:3000"), { APP_ORIGIN: "http://localhost:3000" }), true);
  assert.equal(isAllowedOrigin(request("http://127.0.0.1:3000"), { APP_ORIGIN: "http://localhost:3000" }), false);
});

test("untrusted origins and spoofed proxy headers never authorize a request", () => {
  for (const origin of ["null", "https://other.vercel.app", "https://skillpulse.vercel.app.evil.example", "http://skillpulse.vercel.app", "https://skillpulse.vercel.app:444"]) {
    assert.equal(isAllowedOrigin(request(origin), vercel), false);
  }
  assert.equal(isAllowedOrigin(new Request("https://skillpulse.vercel.app/api/auth/login"), vercel), false);
  const spoofed = new Request("https://evil.example/api/auth/login", { headers: { origin: "https://evil.example", host: "evil.example", "x-forwarded-host": "evil.example" } });
  assert.equal(isAllowedOrigin(spoofed, vercel), false);
});

test("missing or malformed origin configuration fails closed without throwing", () => {
  for (const APP_ORIGIN of [undefined, "", "not-a-url", "null", "https://example.org/login", "https://user:pass@example.org", "https://example.org?query=1", "ftp://example.org"]) {
    assert.deepEqual(trustedOrigins({ APP_ORIGIN }), []);
  }
  assert.deepEqual(trustedOrigins({ VERCEL_URL: "untrusted.vercel.app" }), []);
});

test("preview deployments do not automatically trust the production domain", () => {
  const preview = { ...vercel, VERCEL_ENV: "preview", APP_ORIGIN: undefined };
  assert.equal(isAllowedOrigin(request("https://skillpulse.vercel.app"), preview), false);
  assert.equal(isAllowedOrigin(request("https://skillpulse-build.vercel.app"), preview), true);
});

test("Vercel and HTTPS VPS sessions use secure cookies; local HTTP still works", () => {
  assert.equal(secureSessionCookie(vercel), true);
  assert.equal(secureSessionCookie({ APP_ORIGIN: "https://skills.example.org" }), true);
  assert.equal(secureSessionCookie({ APP_ORIGIN: "http://localhost:3000" }), false);
});

test("deployment preflight validates configuration without exposing secrets or connecting to a database", () => {
  const valid = {
    ...process.env, ...vercel, DOTENV_CONFIG_PATH: ".env.test-nonexistent", DEMO_MODE: "false",
    DATABASE_URL: "postgresql://user:private-password@db.example.org:5432/skillpulse",
    DIRECT_URL: "", SESSION_SECRET: "a".repeat(64), FIELD_ENCRYPTION_KEY: "b".repeat(64)
  };
  const run = (overrides: Record<string, string>) => spawnSync(process.execPath, ["--import", "tsx", "scripts/check-deployment.ts"], { env: { ...valid, ...overrides }, encoding: "utf8" });
  assert.equal(run({}).status, 0);
  assert.equal(run({ VERCEL: "", APP_ORIGIN: "https://skills.example.org" }).status, 0);
  const invalid = run({ SESSION_SECRET: "private-secret-too-short", DATABASE_URL: "postgresql://user:private-password@localhost:5432/skillpulse" });
  assert.equal(invalid.status, 1);
  assert.match(invalid.stderr, /SESSION_SECRET/);
  assert.match(invalid.stderr, /hosted database/);
  assert.doesNotMatch(invalid.stderr, /private-password|private-secret-too-short/);
  const pooled = "postgresql://user:password@aws-0-region.pooler.supabase.com:6543/postgres";
  assert.equal(run({ DATABASE_URL: pooled }).status, 1);
  assert.equal(run({ DATABASE_URL: `${pooled}?pgbouncer=true`, DIRECT_URL: pooled.replace(":6543", ":5432") }).status, 0);
  assert.equal(run({ DIRECT_URL: pooled }).status, 1);
});