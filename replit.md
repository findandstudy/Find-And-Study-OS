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
│   ├── db/                 # Drizzle ORM schema + DB connection
│   └── integrations-anthropic-ai/  # Anthropic SDK wrapper (AI document extraction)
├── scripts/                # Utility scripts
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── tsconfig.json
└── package.json
```

## Authentication

- Replit Auth via OpenID Connect (PKCE) — full OIDC flow with session cookies
- OIDC routes: `/api/auth/login` (redirect to Replit), `/api/callback` (OIDC callback), `/api/auth/logout`
- Sessions stored in `sessions` table (PostgreSQL), 7-day TTL, httpOnly secure cookies
- Auth middleware runs on every request; loads user from session cookie (`sid`)
- Auto-creates users on first login with role `pending` and `isActive: false` — admin must activate
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
- **Students page**: AI-powered student creation (multi-step: upload docs → Claude reads & fills form → user reviews/completes); bulk CSV import with AI column mapping; new fields: motherName, fatherName, passportIssueDate
- Applications page with stage filter + pipeline summary; "New Application" modal with student search, country/university/level/program/language/intake selects
- Leads page: Kanban drag-and-drop with estimatedValue revenue display (role-gated)
- Finance page — full redesign with commission tracking, service fees, Article 6 offsets
- Settings page (profile/language/notifications/security tabs)

### Agent Portal
- Dashboard with commission bar chart, referral link copier, referred-students list

### Student Portal
- Dashboard

## AI Integration

- Provider: Anthropic Claude (via Replit AI Integrations proxy — no API key needed)
- Env vars: `AI_INTEGRATIONS_ANTHROPIC_BASE_URL`, `AI_INTEGRATIONS_ANTHROPIC_API_KEY` (auto-set)
- Model used: `claude-sonnet-4-6` for document OCR; `claude-haiku-4-5` for CSV parsing
- API routes: `POST /api/ai/extract-document` (base64 images/PDFs → student field extraction), `POST /api/ai/extract-bulk-csv` (CSV text → student array)
- Bulk student import: `POST /api/students/bulk` (array of students, returns `{ inserted, errors, success }`)

## DB Schema — Students Extra Fields

Added to `studentsTable`: `motherName`, `fatherName`, `passportIssueDate`, `address`

## DB Schema — Finance System

**commissionsTable** redesigned:
- `programFee`, `universityCommissionRate`, `universityCommissionAmount`, `universityCollected`
- `agentCommissionRate`, `agentCommissionAmount`, `agentPaid`
- `status`: `potential` → `confirmed` → `collected_partial` / `collected_full` → `settled`
- `confirmedAt`, `offsetAmount` (Article 6 offset for state universities, max 70% of confirmed commission)
- `isStateUniversity`, `season`, `studentName`, `universityName`, `programName`

**serviceFeesTable** (new):
- `totalAmount`, `firstInstallmentAmount/PaidAt`, `secondInstallmentAmount/PaidAt`
- `payerType` (student/agent), `status` (pending/partial/paid)
- Auto-status derived from installment paid dates
- `isStateUniversity` (for offset eligibility)

**Finance API endpoints**:
- `GET/POST /api/commissions` — with summary totals
- `GET/PATCH/DELETE /api/commissions/:id`
- `GET/POST /api/service-fees` — with summary totals
- `PATCH/DELETE /api/service-fees/:id`
- `GET /api/finance/summary?season=` — overall dashboard numbers

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
