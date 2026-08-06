# Redrob ATS

In-house, customizable Applicant Tracking System. See `PRD.md`-equivalent requirements in the
project brief; this repo is built module by module, starting with the foundation described below.

## Stack

Next.js 15 (App Router) · TypeScript · TailwindCSS v4 · shadcn/ui (hand-vendored components,
see "Note on shadcn/ui" below) · Prisma 7 (`@prisma/adapter-pg`) · PostgreSQL · Auth.js v5
(Credentials + JWT) · React Hook Form · Zod

## Module 1 — Foundation, Auth & RBAC, Customization Engine

What's implemented:

- **Auth**: email/password login (Auth.js v5, JWT sessions), edge-safe middleware route
  protection (`src/middleware.ts` + `src/lib/auth/auth.config.ts`).
- **RBAC**: admin-defined roles, not a fixed list. Grants are `(resource, action, scope)` —
  scope is `OWN` / `TEAM` / `ALL`. Enforced server-side on every request via
  `src/lib/authz/authorize.ts`, never only hidden in the UI. Exactly one seeded
  "System Administrator" role bypasses checks (`Role.isSuperAdmin`) so a misconfigured
  permission set can never lock every admin out.
- **Field-level permissions**: `FieldPermission` restricts individual fields per role
  (`src/lib/authz/authorize.ts#getFieldAccess`), independent of entity-level grants.
- **Customization engine**: `CustomFieldDefinition` (text/number/date/dropdown/multi-select/
  lookup fields on any registered entity) and `CustomObjectDefinition` (admin-defined entities
  with no dedicated table — records are JSON rows, not runtime `CREATE TABLE`). See
  `src/lib/entity-registry.ts` for how future modules plug their entities into this engine.
- **Admin settings**: users, roles & permission matrix, custom fields/objects, and a searchable
  audit log, all under `/admin/*`.

## Local development

```bash
cp .env.example .env        # then fill in AUTH_SECRET: npx auth secret
docker compose up -d        # starts Postgres
npx prisma migrate dev      # applies the schema
npx prisma db seed          # seeds default roles, controlled lists, and an admin user
npm run dev
```

Sign in at `http://localhost:3000/login` with `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD`
from your `.env` (defaults to `admin@redrob.local` / `ChangeMe123!` if unset — change these
before any shared/deployed environment).

## Note on shadcn/ui

The `shadcn` CLI registry (`ui.shadcn.com`) is not reachable from this environment, so the
components under `src/components/ui/` were hand-authored in the same shape the CLI generates
(same file layout, same Radix primitives, same `cn()` convention). `components.json` is in
place — if registry access is available elsewhere, `npx shadcn add <component>` will work
normally and stay consistent with what's already here.

## Project structure

```
src/
  app/            Next.js App Router routes ((app) = authenticated shell, admin/* = settings)
  components/      ui/ (shadcn primitives), layout/, admin/, auth/
  lib/
    authz/         session context + authorize()/can()/getFieldAccess()
    services/      permission-checked business logic (roles, users, custom fields/objects, audit)
    validations/   Zod schemas, shared by API routes and client forms
    custom-fields/ dynamic Zod schema builder for admin-defined fields
    api/           withApiHandler — the one place mapping domain errors to HTTP status codes
  generated/prisma Generated Prisma Client (gitignored, run `npx prisma generate`)
prisma/
  schema.prisma   Data model (see inline comments for the entity-registry/JSON-field design notes)
  seed.ts         Default roles, controlled lists, admin user
```
