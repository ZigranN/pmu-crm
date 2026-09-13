This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.

## Development

### Bootstrap a development studio

1. Fill the studio settings and `SEED_ADMIN_EMAIL` in your ignored `.env.local`.
2. Apply committed migrations with `npm run db:migrate`. Do not generate migrations during setup.
3. Register at `/register` with that email and a password of your choice.
4. Run `npm run db:seed` to link the registered user to the studio.
5. Sign in at `/login` and open `/dashboard`.

Seed does not create accounts or print credentials. Repeating it preserves studio data,
existing memberships and edited demo services. It adds missing default grants for OWNER/ADMIN/MASTER; AI_SYSTEM has no generic action grants.
System-role prohibitions cannot be bypassed with personal allow overrides. Master resource scoping is the next step (1.2). `SEED_DEMO_SERVICES=false` is the default.
Enable it only for demo data: the three sample prices are not an approved production catalog.
Migrations through `0005` are required before running this version of the app or seed.
Seed links the configured account as OWNER only if no membership exists. Existing memberships are preserved.
Legacy STUDIO_ADMIN/SUPER_ADMIN memberships resolve to OWNER within their studio; ASSISTANT resolves to ADMIN with its existing grants. Auth user.role does not grant studio access.

## Automated checks (Phase 0.2)

Use Node **22.22.2** (`nvm install && nvm use`) and `npm ci`.
Copy `.env.example` to `.env.local` for development and supply your own local values.
Tests and `build:test` use synthetic configuration; they do not use application credentials.

```bash
npm run typecheck
npm run lint
npm test
npm run build:test
npx playwright install chromium
npm run test:e2e
```

`npm test` runs migration tests, Vitest unit/integration checks and the known-defect
regressions. Local integration tests default to isolated PGlite. For server PostgreSQL:

```bash
docker compose -f compose.test.yml up -d --wait
TEST_DATABASE_URL=postgresql://pmu_test:local-only@127.0.0.1:5433/pmu_test npm run test:postgres
docker compose -f compose.test.yml down
```

The container stores only disposable synthetic data in tmpfs. Tests accept only loopback
PostgreSQL URLs and a database named `pmu_test` or `pmu_test_*`, without URL options.
Migrations run in that database; cleanup removes only fixtures created by this run.
Do not put application data in a database with that name. `test:postgres` fails if
TEST_DATABASE_URL is absent; CI never silently falls back to PGlite.

The browser smoke suite starts its own production build on port 3100. The failed-login
response is mocked there; actual auth/session behavior is tested in the integration suite.
If the local environment cannot launch Chromium, `npm run test:e2e:http` verifies only HTTP smoke checks, not browser behavior. Run `build:test` before `test:e2e`; that build embeds a local URL and must not be deployed.
Use the normal `build` command with deployment configuration for releases.

See [test baseline and known defects](docs/phase3/TEST-BASELINE.md).
The [CI workflow](.github/workflows/ci.yml) runs on push and pull request with a disposable
PostgreSQL 17 service and synthetic credentials. No Neon, Cloudinary or AI keys are required.

The authenticated master-edit E2E requires the disposable PostgreSQL service and TEST_DATABASE_URL. Playwright passes that validated test URL to its app server; build:test continues to use synthetic build configuration. CI runs the full suite with PostgreSQL.
