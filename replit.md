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
- **Pipeline stages are dynamic** — stored in `pipeline_stages` DB table, managed via API
  - API: `GET/PUT /api/pipeline-stages/:entityType` (entity types: `lead`, `application`, `student`)
  - Default stages auto-seeded on first fetch; managers can add/remove/reorder/rename stages
  - Stage keys are immutable after creation (labels/variants/order can change)
  - Frontend uses `usePipelineStages(entityType)` hook + shared `EditStagesDialog` component
  - Default lead stages: new, contacted, interested, qualified, converted, won, lost
  - Default application stages: inquiry, documents_collected, submitted, offer_received, visa_applied, visa_approved, enrolled, rejected
  - Default student stages: active, inactive, graduated, suspended

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
- **User Management** page with two tabs:
  - **Users tab**: User listing with search, role filters, stats cards (Total/Staff/Students/Agents), "Create User" modal with role/language selection; role filter pills (All/Staff/Student/Agent/Admin)
  - **Roles & Permissions tab**: Full role management system with 10 system roles (super_admin, admin, manager, staff, consultant, accountant, editor, student, agent, sub_agent); granular permission editor across 12 categories (Dashboard, Leads, Applications, Students, Documents, Course Finder, Agents, Finance, Catalog, Users, Audit, Settings) with 49 total permissions; create custom roles; select/deselect all; per-category toggle; system roles protected from deletion; role deletion blocked if users assigned
- **Roles DB table**: `roles` — `id, name, displayName, description, color, isSystem, permissions (JSONB), createdAt, updatedAt`
- **Roles API**: `GET /api/roles`, `GET /api/roles/:id`, `POST /api/roles`, `PATCH /api/roles/:id`, `DELETE /api/roles/:id`, `GET /api/roles/permissions-schema`
- Default seeds auto-run on first API server start; role validation on user create/patch checks both built-in and DB roles

### Staff Portal
- **Students page**: Pipeline view (status columns: active/inactive/graduated/suspended) + list view with sortable columns, bulk select/delete, inline edit dialog; AI-powered student creation (multi-step: upload docs → Claude reads & fills form → user reviews/completes); bulk CSV import with AI column mapping; filter by status; view toggle stored in localStorage (`edcons_students_view`)
- **Applications page**: Pipeline view (8 stage columns with revenue totals per column) + list view with sortable columns, bulk select/delete, edit dialog; tuition fee displayed on cards and column headers; filter by stage/country; "New Application" modal with student search, cascading country→university→program dropdowns; view toggle stored in localStorage (`edcons_applications_view`)
- **Leads page**: Pipeline view (Kanban columns) + list view with sortable columns, bulk select/delete, edit dialog; estimatedValue revenue display (role-gated); view toggle stored in localStorage (`edcons_leads_view`)
- Finance page — full redesign with commission tracking, service fees, Article 6 offsets, university breakdown, financial transaction recording with file uploads, analytics dashboard
- **Course Finder** — Program search/filter with PDF proposal generation; select individual or bulk programs → generate premium PDF proposal with university logos, tuition info, scholarships, commissions; logo logic: agents get their agency logo, staff/admin/students get system logo; selection clears on page/filter change
- **Settings page** (profile/language/notifications/security tabs) + **Branding tab** (manager+ only): system logo upload (light + dark mode), theme color pickers (primary/button/hover as hex), dark mode toggle (light/dark/system); public branding API: `GET /api/settings/branding`; dark mode toggle also in header bar (Moon/Sun icon)

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

## DB Schema — Follow-ups

**followUpsTable** — tracks scheduled follow-up actions on leads/students:
- `leadId`, `studentId`, `resourceType` (lead/student), `title`, `scheduledAt`
- `completed`, `completedAt`, `assignedToId`, `createdById`, `notes`
- API: `GET /api/leads/:id/follow-ups`, `POST /api/leads/:id/follow-ups`, `PATCH /api/follow-ups/:id`
- Dashboard widget: `GET /api/follow-ups/upcoming` (next 7 days, incomplete only)

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

**financialTransactionsTable** (new):
- `commissionId`, `type` (collection/agent_payment), `amount`, `currency`, `transactionDate`
- `reference`, `universityName`, `agentId`, `agentName`, `studentName`
- `fileUrl`, `fileName` (for attached invoices/receipts via object storage)
- Auto-updates commission `universityCollected`/`agentPaid` and status on create/delete

**Finance API endpoints**:
- `GET/POST /api/commissions` — with summary totals
- `GET/PATCH/DELETE /api/commissions/:id`
- `GET/POST /api/service-fees` — with summary totals
- `PATCH/DELETE /api/service-fees/:id`
- `GET /api/finance/summary?season=` — overall dashboard numbers (includes overdue count/amount)
- `GET /api/finance/university-breakdown?season=` — per-university: commission, collected, remaining, agent payouts, net income, aging
- `GET/POST /api/financial-transactions` — collection & agent payment records with file attachments
- `DELETE /api/financial-transactions/:id` — auto-recomputes commission totals and status
- `POST /api/storage/uploads/request-url` — presigned URL for file upload (auth required)
- `GET /api/storage/objects/*` — serve uploaded files (auth required)

## Application Cascading Selects & Auto-fill

Both the **Add Application** modal and **Edit Application** dialog use cascading selects for university/program selection:
- **Country** → fetched dynamically from `GET /api/universities/countries` (only countries with universities in DB)
- **University** → filtered by country via `GET /api/universities?country=X&limit=100`
- **Program** → filtered by university via `GET /api/programs?universityId=X&limit=100`
- Changing a parent field resets all child fields (country change → clears university + program)
- **Auto-fill on program select**: `tuitionFee` = `discountedFee ?? tuitionFee` from the program record
- If a `discountedFee` exists, an "İndirimli" badge is shown and fee breakdown (Standart / İndirimli / Komisyon %) is displayed
- Program selection also auto-fills Level (from degree) and Language (if available)
- Both dialogs save `universityId`, `universityName`, `programId`, `programName` to maintain referential integrity
- Commission calculations should use the effective tuition fee (discountedFee takes priority)
- Filter popover country dropdown also uses the dynamic countries list

## Course Finder

- Page: `artifacts/edcons/src/pages/staff/CourseFinder.tsx`, route `/staff/course-finder`
- Allowed roles: STAFF_ROLES + AGENT_ROLES
- Sidebar: Operations (admin/manager/super_admin), Work (staff), Agent Portal (agent/sub_agent)
- API: `GET /api/course-finder` (programs joined with universities, paginated), `GET /api/course-finder/filters` (distinct filter options)
- Filters: Country, City, University Type, University, Study Level, Language, Tuition Fee Range (min/max), free-text search
- Wishlists: `GET/POST/DELETE /api/wishlists` (authenticated, per-user)
- Commission display: shows calculated commission **amount** (commissionRate × effectiveFee / 100), not percentage — visible to super_admin, agent, sub_agent roles
- Program cards show: university logo, degree/language/duration/country badges, tuition & discounted fee (with feeType badge), scholarship, app fee, intakes, commission amount, open/closed status
- Details dialog: full program info, university details, all fees breakdown (including feeType and scholarship highlight), requirements
- **Apply button**: Opens ApplyDialog — shows program summary, AJAX student search (last 3 recent + full search by name/email/phone), notes field, submit creates application + commission + service fee atomically
- Apply API: `POST /api/course-finder/apply` {studentId, programId, notes} — creates application (stage: inquiry), commission (if commissionRate > 0, status: potential), service fee (if serviceFeeAmount > 0, 50/50 installments, status: pending)
- Student search API: `GET /api/course-finder/students?search=&limit=` — searches by firstName, lastName, email, phone, full name; returns most recent first

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
