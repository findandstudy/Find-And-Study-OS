# Workspace

## Overview

**EdCons OS** — Education Consultancy Operating System. A production-ready SaaS for education consultancy businesses. pnpm workspace monorepo using TypeScript.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5
- **Database**: PostgreSQL + Drizzle ORM
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild (CJS bundle)
- **Frontend**: React + Vite + TailwindCSS + shadcn/ui + Framer Motion

## Structure

```text
artifacts-monorepo/
├── artifacts/
│   ├── api-server/         # Express API server (port 8080)
│   └── edcons/             # React + Vite frontend
├── lib/
│   ├── api-spec/           # OpenAPI spec + Orval codegen config
│   ├── api-client-react/   # Generated React Query hooks
│   ├── api-zod/            # Generated Zod schemas from OpenAPI
│   └── db/                 # Drizzle ORM schema + DB connection
├── scripts/                # Utility scripts
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── tsconfig.json
└── package.json
```

## Authentication

- Replit Auth via `x-replit-user-id` headers
- Auto-creates users on first Replit login with role `pending` and `isActive: false` — admin must activate
- Roles: `super_admin`, `admin`, `manager`, `staff`, `consultant`, `editor`, `accountant`, `student`, `agent`, `sub_agent`, `pending`
- Role routing: admin/manager/super_admin → `/admin`, staff/consultant/accountant/editor → `/staff`, student → `/student`, agent/sub_agent → `/agent`
- Finance read (GET invoices/commissions): STAFF_ROLES; Finance write (POST/PATCH): FINANCE_ROLES (super_admin, admin, manager, accountant)
- Settings PATCH: MANAGER_ROLES only; sensitive fields (smtpPassword, whatsappToken) stripped from GET
- Contact form submits to `/api/public/lead` (rate-limited: 10 req/15min)

## API Notes

- API server runs on port 8080; frontend uses Vite proxy to `/api`
- Paginated endpoints return `{ data: [...], meta: {...} }` — normalize with `(resp as any)?.data || resp || []`
- Blog/Universities GET endpoints are public (no auth required)
- Blog posts use `published: boolean` field (not `status`)
- Application stages: `inquiry → documents_collected → submitted → offer_received → visa_applied → visa_approved → enrolled → rejected`
- Lead stages: `new, contacted, interested, qualified, converted, lost`

## Frontend Key Files

- `artifacts/edcons/src/App.tsx` — All routes
- `artifacts/edcons/src/components/layout/DashboardLayout.tsx` — Role-based navigation
- `artifacts/edcons/src/pages/public/` — Home, About, Programs, Blog, Contact
- `artifacts/edcons/src/pages/admin/` — Admin portal (Dashboard, Users)
- `artifacts/edcons/src/pages/staff/` — Staff portal (Applications, Finance, Settings)
- `artifacts/edcons/src/pages/student/` — Student portal (Dashboard)
- `artifacts/edcons/src/pages/agent/` — Agent portal (Dashboard)

## Implemented Features

### Public Site
- Home page with hero, stats, programs preview, testimonials
- About page with team + stats
- Programs page with filterable university cards (country/level filters)
- Blog page with category filter + article cards (uses `published` boolean field)
- Contact page with form + office info
- Login page (split-panel, Replit Auth)

### Admin Portal
- Dashboard with area/bar charts and system alerts
- Users management table with role badges and filters

### Staff Portal
- Applications page with stage filter + pipeline summary
- Finance page with invoices + commissions (charts + Tabs UI)
- Settings page (profile/language/notifications/security tabs)

### Agent Portal
- Dashboard with commission bar chart, referral link copier, referred-students list

### Student Portal
- Dashboard

## Frontend Notes

- Vite config has `dedupe: ["react", "react-dom"]` to prevent duplicate React issues
- Uses `@dnd-kit/*` for Kanban drag-drop
- CSS uses `@plugin "tailwindcss-animate"` and `DM Sans` + `Outfit` fonts
- Never read generated codegen files (they're large); use grep to check export names

## TypeScript & Composite Projects

Every package extends `tsconfig.base.json` which sets `composite: true`. The root `tsconfig.json` lists all packages as project references.

- **Always typecheck from the root** — run `pnpm run typecheck`
- **`emitDeclarationOnly`** — only emit `.d.ts` files during typecheck
- Run codegen: `pnpm --filter @workspace/api-spec run codegen`
- Push DB schema: `pnpm --filter @workspace/db run push`

## Root Scripts

- `pnpm run build` — runs `typecheck` first, then recursively runs `build` in all packages
- `pnpm run typecheck` — runs `tsc --build --emitDeclarationOnly` using project references
