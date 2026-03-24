# EduConsult OS - Production Readiness Audit Report

**Date:** 2026-03-24  
**Auditor:** Senior Architect Review  
**Scope:** Full codebase security, stability, and production readiness audit

---

## Executive Summary

The EduConsult OS platform demonstrates solid foundational security with session-based authentication, role-based access control, parameterized database queries (Drizzle ORM), and proper IDOR prevention. Several critical and high-severity issues were identified and fixed. Remaining items are documented as a checklist below.

---

## Findings by Severity

### CRITICAL - Fixed

| # | Issue | File(s) | Fix Applied |
|---|-------|---------|-------------|
| C1 | **Hardcoded passwords in source code** - Super admin and agent seed passwords were plaintext in `index.ts` | `artifacts/api-server/src/index.ts` | Replaced with `process.env.SEED_ADMIN_PASSWORD` and `process.env.SEED_AGENT_PASSWORD` environment variables |
| C2 | **Error message leakage in AI routes** - `err.message` returned to client, potentially exposing API keys, internal paths, or DB connection strings | `artifacts/api-server/src/routes/ai-extract.ts` | Replaced with generic error messages ("AI extraction failed", "CSV parsing failed") |

### HIGH - Fixed

| # | Issue | File(s) | Fix Applied |
|---|-------|---------|-------------|
| H1 | **XSS in embeddable widget** - Unescaped database values (logo URLs, filter options) injected into HTML | `artifacts/api-server/src/routes/embed.ts` | Wrapped all dynamic values with existing `esc()` function |
| H2 | **Missing rate limiting on AI endpoints** - AI extraction routes had no rate limits, enabling resource exhaustion/DoS | `artifacts/api-server/src/routes/ai-extract.ts` | Added per-user rate limiting (10 req/15min for document extraction, 5 req/15min for CSV bulk) |
| H3 | **No process crash handlers** - Unhandled promise rejections could silently crash the server | `artifacts/api-server/src/index.ts` | Added `process.on('unhandledRejection')` and `process.on('uncaughtException')` handlers |
| H4 | **Global error handler leaks details in non-production** - Any environment besides explicit "production" exposed `err.message` | `artifacts/api-server/src/app.ts` | Changed to only expose messages for client errors (4xx); all 5xx errors now return generic message regardless of environment |
| H5 | **Excessive request body size (50MB)** - Could be exploited for memory exhaustion | `artifacts/api-server/src/app.ts` | Reduced `express.json` and `express.urlencoded` limit from 50MB to 10MB |

### CRITICAL - Fixed (Authorization)

| # | Issue | File(s) | Fix Applied |
|---|-------|---------|-------------|
| C3 | **`isActive` field in user self-patch** - Regular users could activate/deactivate their own account by including `isActive` in PATCH body | `artifacts/api-server/src/routes/users.ts` | Moved `isActive` from `ALLOWED_PATCH_FIELDS` to `ADMIN_PATCH_FIELDS` |

### HIGH - Fixed (Data Leakage & Path Traversal)

| # | Issue | File(s) | Fix Applied |
|---|-------|---------|-------------|
| H7 | **University contact info exposed on public endpoint** - `contactPersonName`, `contactPersonPhone`, `contactPersonEmail` sent to unauthenticated users via `/api/course-finder` | `artifacts/api-server/src/routes/course-finder.ts` | Contact fields restricted to staff and agent roles only; stripped for unauthenticated users and students |
| H8 | **Path traversal on storage endpoints** - `..` sequences in object path could traverse directory tree | `artifacts/api-server/src/routes/storage.ts` | Added `..` and `\` rejection on both `/storage/objects/*` and `/storage/public-objects/*` |

### HIGH - Fixed (Security Headers)

| # | Issue | File(s) | Fix Applied |
|---|-------|---------|-------------|
| H6 | **Missing security headers** - No `X-Content-Type-Options`, `Referrer-Policy`, or `Permissions-Policy` headers | `artifacts/api-server/src/app.ts` | Added `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy: camera=(), microphone=(), geolocation=()` |

---

### MEDIUM - Fixed

| # | Issue | Fix Applied |
|---|-------|-------------|
| M1 | **No CSRF protection** | Double-submit cookie CSRF pattern added. `csrf_token` cookie + `x-csrf-token` header validated on POST/PATCH/DELETE. Excluded paths: `/api/public/`, `/api/course-finder`, `/api/auth/`. Frontend global fetch interceptor in `csrfSetup.ts`. |
| M2 | **Content Security Policy disabled** | CSP enabled in Helmet with `script-src 'self' 'unsafe-inline'`, `style-src 'self' 'unsafe-inline'` (required for shadcn/Tailwind), `object-src 'none'`, `frame-ancestors 'self'`. |
| M3 | **Missing database foreign key constraints** | FK references added to all schema files with appropriate ON DELETE actions (SET NULL for nullable FKs, CASCADE for child records, RESTRICT for required FKs). |
| M4 | **Missing unique constraint on `students.email`** | Unique index added on `students.email`. |
| M5 | **Missing database indexes** | Indexes added on frequently filtered columns (`agentId`, `studentId`, `status`, `season`, `assignedToId`, etc.) across students, applications, leads, documents, finance schemas. |
| M6 | **Async routes without try-catch** | Express 5.2.1 natively propagates async errors to the error handler — no wrapper needed. |
| M8 | **Rate limiting on storage upload endpoint** | In-memory rate limiter added: 30 uploads per 15 minutes per user on `POST /storage/uploads/request-url`. |

### MEDIUM - Remaining

| # | Issue | Details | Priority |
|---|-------|---------|----------|
| M7 | **`dangerouslySetInnerHTML` in chart component** | `ChartStyle` component in `chart.tsx` injects CSS via `dangerouslySetInnerHTML`. Low risk if chart config is developer-controlled. | Low-Medium |
| M9 | **Sequential DB queries in POST /applications** | Multiple `await` calls (student, program, university lookups) could be parallelized with `Promise.all` for better latency. | Low-Medium |
| M10 | **Audit log writes are synchronous** | `logAudit()` is awaited inline in request handlers. Should be fire-and-forget or queued to avoid adding latency. | Low |

### LOW - Fixed

| # | Issue | Fix Applied |
|---|-------|-------------|
| L1 | **No pagination on sub-resource endpoints** | Pagination (page/limit with defaults and max caps) added to: application notes, lead notes, lead follow-ups, stage documents, missing-doc notes, sub-agents. |

### LOW - Remaining

| # | Issue | Details |
|---|-------|---------|
| L2 | **In-memory rate limiter for auth routes** | Uses a `Map` that resets on server restart. Acceptable for single-instance deployments, but consider Redis-backed limiter for multi-instance. |
| L3 | **`students.userId` and `agents.userId` are nullable** | Allows orphaned entities. Consider making non-null with migration for existing data. |
| L4 | **Missing HSTS header** | Helmet enables it by default, but verify it's present in production responses. |

### NEW - Soft Delete

| # | Feature | Details |
|---|---------|---------|
| S1 | **Soft delete for students** | `deletedAt` column added. DELETE sets timestamp instead of hard-deleting. GET queries filter `WHERE deletedAt IS NULL`. |
| S2 | **Soft delete for applications** | `deletedAt` column added. DELETE sets timestamp instead of hard-deleting. GET queries filter `WHERE deletedAt IS NULL`. |
| S3 | **Soft delete for documents** | `deletedAt` column added. Single and bulk DELETE set timestamp instead of hard-deleting. GET queries filter `WHERE deletedAt IS NULL`. |

---

## What's Already Done Well

- **SQL Injection**: No vulnerabilities found. Drizzle ORM parameterizes all queries. Manual `sql` uses proper template interpolation.
- **Authentication**: bcrypt (salt 10), secure session cookies (`httpOnly`, `secure`, `sameSite: lax`), 7-day TTL.
- **Authorization**: Consistent `requireAuth` + `requireRole()` middleware. IDOR prevention with ownership checks on students, applications, leads, documents.
- **SEO**: Public pages have proper meta tags, OG tags, canonical URLs. Private pages use `noindex`.
- **Audit Logging**: All create/update/delete operations logged with user ID and IP.
- **Input Validation**: ID parsing with `parseInt` + `isNaN` checks. String length limits. Zod validation on storage routes.
- **CORS**: Properly configured with dynamic origin whitelist. Public embed routes allow any origin without credentials.
- **Rate Limiting**: Auth routes (login, register, verify) have rate limits. Public apply and embed submit have limits.

---

## Files Changed in This Audit

| File | Changes |
|------|---------|
| `artifacts/api-server/src/index.ts` | Removed hardcoded passwords, added env var references, added crash handlers |
| `artifacts/api-server/src/app.ts` | Added security headers, reduced body size limit, hardened error handler, CSP enabled, CSRF double-submit cookie middleware |
| `artifacts/api-server/src/routes/ai-extract.ts` | Added rate limiting, removed error message leakage |
| `artifacts/api-server/src/routes/embed.ts` | Escaped all dynamic values in widget HTML to prevent XSS |
| `artifacts/api-server/src/routes/users.ts` | Moved `isActive` to admin-only patch fields |
| `artifacts/api-server/src/routes/course-finder.ts` | Stripped contact info for unauthenticated requests |
| `artifacts/api-server/src/routes/storage.ts` | Added path traversal protection, upload rate limiting (30 req/15min) |
| `artifacts/api-server/src/routes/students.ts` | Soft-delete logic (DELETE sets `deletedAt`, GET filters `deletedAt IS NULL`) |
| `artifacts/api-server/src/routes/applications.ts` | Soft-delete logic, notes pagination |
| `artifacts/api-server/src/routes/documents.ts` | Soft-delete logic (single + bulk delete) |
| `artifacts/api-server/src/routes/leads.ts` | Notes and follow-ups pagination |
| `artifacts/api-server/src/routes/agents.ts` | Sub-agents pagination |
| `artifacts/api-server/src/routes/applicationStageDocuments.ts` | Stage documents and missing-doc notes pagination |
| `artifacts/edcons/src/lib/csrfSetup.ts` | Global fetch interceptor for CSRF token handling |
| `artifacts/edcons/src/main.tsx` | Import csrfSetup |
| `lib/db/src/schema/students.ts` | FK references, indexes, unique email constraint, `deletedAt` column |
| `lib/db/src/schema/applications.ts` | FK references, indexes, `deletedAt` column |
| `lib/db/src/schema/documents.ts` | FK references, indexes, `deletedAt` column |
| `lib/db/src/schema/*.ts` | FK references and indexes across all schema files |

---

## Recommendations for Production Deployment

1. **Set strong, unique values** for `SEED_ADMIN_PASSWORD` and `SEED_AGENT_PASSWORD` in development only
2. **Change default admin password** before going to production
3. **Set up monitoring/alerting** for the unhandled rejection and uncaught exception handlers
4. **Consider Redis-backed rate limiting** for multi-instance deployments
