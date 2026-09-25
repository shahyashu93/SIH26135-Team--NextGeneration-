# Deployment: Vercel And VPS

The same UI, roles, workflows and deterministic metrics run on both targets. All prototype data is synthetic. These instructions cover deployment, not certification for real personal data or unrestricted production use.

## Required Configuration

Keep secrets in platform environment settings or a protected, untracked environment file. Never use a `NEXT_PUBLIC_` prefix for database credentials or secrets. Do not upload your local environment file to Git.

Always build with `npm run build` (or `npm run build:vercel`), not a bare `next build`. The postbuild step removes environment files that Next.js copies into standalone output. Supply secrets when starting the deployed process, not by bundling environment files into the artifact.

| Variable | Hosted value |
| --- | --- |
| `DATABASE_URL` | PostgreSQL runtime connection. For Vercel/Supabase, use the transaction pooler on port 6543 with `pgbouncer=true&connection_limit=1&pool_timeout=20&sslmode=require`. Tune the connection limit only within your database's connection budget. |
| `DIRECT_URL` | Optional for local PostgreSQL; required by the preflight check when using the Supabase transaction pooler. Use Supabase session mode on port 5432 or a reachable direct connection for migrations and seeding. Include `sslmode=require` for Supabase. |
| `APP_ORIGIN` | Public origin, e.g. `https://sih-26135-team-next-generation.vercel.app`. No `/login`, query, credentials, or fragment. Required on a VPS and for custom domains. |
| `SESSION_SECRET` | Random secret, at least 32 characters. Keep identical across replicas. Changing it invalidates existing sessions. |
| `FIELD_ENCRYPTION_KEY` | Exactly 64 hexadecimal characters (32 random bytes). Preserve this key across deployments and backups; changing it makes existing encrypted contact data unreadable. |
| `DEMO_MODE` | `false` for publicly accessible deployments. `true` enables passwordless role access and should only be used behind platform access protection or a private network. |
| `DEMO_PASSWORD` | Needed only when initially seeding demo users; at least 12 characters. It is not a runtime password reset mechanism. |
| `REDIS_URL` | Required by the persistent reminder worker, not by the web app. |
| `AI_BASE_URL`, `AI_API_KEY`, `AI_MODEL` | Optional. Existing rules-based fallback remains available without them. |

Use the exact connection strings shown in Supabase's Connect panel, with URL-encoded passwords. A typical pooler username includes the project reference. Do not use a Supabase anon/service-role API key as the PostgreSQL password. The runtime uses Prisma/PostgreSQL, not Supabase Auth.

Supabase direct connections may require IPv6. Session-mode pooling on port 5432 is an alternative for IPv4 migration runners. Restrict or disable Supabase's Data API when using this database solely through Prisma, so database tables are not exposed through a second, unintended API.

## Vercel

1. Import the repository as a Next.js project with Node.js **22.x** and the repository root as the root directory. The checked-in Vercel configuration uses `npm ci` and `npm run build:vercel`.
2. Set the environment variables above in Vercel's **Production** environment. Remove any dashboard build-command override that bypasses the checked-in command. Enable **System Environment Variables**.
3. Set `APP_ORIGIN=https://sih-26135-team-next-generation.vercel.app` for the current site, or your actual custom domain. The app also accepts exact domains supplied by Vercel's `VERCEL_URL`, `VERCEL_BRANCH_URL`, and, in production, `VERCEL_PROJECT_PRODUCTION_URL`. It does not trust arbitrary host headers or every `*.vercel.app` domain.
4. Choose a function region close to the database in Vercel settings. API functions have a 60-second execution budget; confirm support in your Vercel plan.
5. Provision the database and apply migrations as described below, then deploy or redeploy. Environment changes require a new deployment. Local environment-file edits do not change Vercel settings.
6. Visit `/api/health`, which should return `{"status":"ok"}`, then sign in using an account actually present in the hosted database.

The preflight check fails the build for missing secrets, unusable origin configuration, a local database URL on Vercel, or incorrect Supabase pooler settings. It never prints credentials or connects to the database. A passing check does not prove network reachability or account existence.

Preview environments must use a **separate database and secrets**, not production data. Scope `APP_ORIGIN` separately, or leave it unset in Preview and use Vercel's exact preview URLs. Protect preview access. Additional domain aliases must use a configured canonical domain or redirect to it.

### Database Release Step

Run these commands from a trusted release runner or workstation with Node.js 22 and the intended hosted environment variables loaded securely:

```sh
npm ci
npm run deploy:check
npm run db:generate
npm run db:migrate
```

`prisma.config.ts` uses `DIRECT_URL` for Prisma CLI operations when provided, otherwise the schema's `DATABASE_URL`. Application queries continue to use `DATABASE_URL`. Migrations are intentionally not run in the Vercel build or on every request; do not let unrelated preview builds migrate a shared production database. Back up an existing database and review migrations before applying them. Never use `migrate reset` or `db push --force-reset` against hosted data.

For a fresh **protected synthetic demo database**, set `DEMO_MODE=true` and a new `DEMO_PASSWORD` only in the seed runner, then run:

```sh
npm run db:seed
```

Seeding uses `DIRECT_URL` when available. It creates the existing demo accounts and dataset. Keep web `DEMO_MODE=false` unless access is protected. Seeding skips an existing dataset; changing `DEMO_PASSWORD` later does not change existing account passwords. Local demo credentials do not automatically exist in Supabase. Do not reseed/reset an existing database just to repair login.

### Scheduled Reminders

Vercel functions cannot host the existing continuously running BullMQ worker. To retain automatic reminders, run `npm run worker` in a persistent Node.js 22 process on a VPS or a worker hosting service, using the **same hosted database** and a reachable Redis service. Supervise it with restart-on-failure and send SIGTERM for graceful shutdown. Do not run this worker from a request handler or the Vercel build. Manual reminders and trainee check-ins keep working without it.

The Docker `tools` target also contains the worker. For a Vercel web deployment, pass the hosted database/Redis configuration to that container rather than using the bundled database in the default Compose stack.

## VPS With Docker Compose

The existing Compose stack includes private PostgreSQL and Redis services, a one-shot migration job, the web app, and the persistent worker. PostgreSQL and Redis are not published to the host. The web app binds only to `127.0.0.1:3000`; terminate public HTTPS in a host reverse proxy.

1. Install Docker Engine with Compose v2, and provision DNS pointing your domain to the VPS. Allow inbound HTTPS and HTTP for certificate issuance; restrict SSH. Do not expose PostgreSQL or Redis ports.
2. On a trusted Node.js 22 machine, run `npm ci` and `npm run setup:local` to generate unique secrets if needed. Transfer the environment securely to the VPS or create it there. Set `APP_ORIGIN=https://your-domain.example`, `DEMO_MODE=false`, and protect the environment file with owner-only permissions. Preserve existing database passwords and encryption keys when upgrading.
3. Build and validate the stack:

```sh
docker compose config --quiet
docker compose build
docker compose run --rm --no-deps migrate npm run deploy:check
docker compose up -d
docker compose ps -a
```

Compose supplies its internal PostgreSQL/Redis URLs to the containers, rather than the native local connection strings. The migration service must exit with status 0 before web and worker start. For subsequent releases, run `docker compose up -d --build --force-recreate migrate` first, inspect its exit status, then run `docker compose up -d --build web worker`. Do not start new application containers if migrations fail.

4. Configure a host TLS reverse proxy such as Caddy. A minimal Caddy site configuration is:

```caddyfile
your-domain.example {
    reverse_proxy 127.0.0.1:3000
}
```

The domain must match `APP_ORIGIN`. Caddy requires working DNS and ports 80/443 to issue and renew certificates. Do not disable origin checks or set wildcard CORS to fix proxy issues.

5. For an initially empty, private synthetic demo, run the seed job explicitly:

```sh
docker compose run --rm -e DEMO_MODE=true seed
```

Set a strong `DEMO_PASSWORD` in the protected Compose environment before seeding. This one-off flag does not enable passwordless role access on the web service.

6. Check `https://your-domain.example/api/health`, password login, a role-scoped dashboard, and worker logs. Back up PostgreSQL and the encryption key separately, test restores, and monitor disk space, database connections, restarts, and health failures. Docker restart policies restart crashed processes; health status alone does not trigger a restart. Never run `docker compose down -v` unless intentionally deleting all persistent data.

For an external VPS database, use the standalone web image and tools image with externally supplied `DATABASE_URL`/`REDIS_URL`, or a reviewed Compose override; the default stack deliberately targets its own PostgreSQL and Redis services.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| `Request origin is not allowed.` | `APP_ORIGIN`, Vercel system variables, the exact browser domain, and whether the new environment was redeployed. This check occurs before login accesses the database. |
| Deployment preflight fails | Fix the named environment setting in the correct target environment. No secret values are logged. |
| Service temporarily unavailable / health fails | Database URL, network/SSL reachability, Supabase project status, migrations, and server logs. Authentication also requires `SESSION_SECRET`. |
| Email or password is incorrect | Account existence and the password used when the hosted database was seeded. |
| Sign-in succeeds but does not persist | Use the configured HTTPS domain; check secure cookies, reverse proxy configuration, and identical session secrets across replicas. |
| Automatic reminders do not arrive | Persistent worker process, Redis connectivity, database configuration, due follow-ups and consent. |

Before release: `npm test`, `npm run lint`, `npm run typecheck`, and `npm run build`. Run `npm run test:integration` only against a protected disposable demo environment; it creates and changes test records. Do not point it at real production data.