# EdCons OS

## Overview

EdCons OS is a production-ready SaaS designed for education consultancy businesses. This pnpm workspace monorepo, built with TypeScript, aims to be a comprehensive operating system, streamlining operations such as lead management, application processing, student tracking, and financial oversight. It provides tools for staff, agents, and students to enhance efficiency, client management, and growth in the education consultancy market. Key capabilities include dynamic pipeline management, robust role-based access control, and AI-powered document processing.

## User Preferences

The user prefers a clean, intuitive UI/UX with a focus on role-based access and clear workflows. They value dynamic content management, such as configurable pipeline stages, and robust authentication with granular permission control. AI integration should be leveraged for efficiency gains, particularly in document processing and data extraction. The system should be scalable and maintainable, built with modern web technologies.

## System Architecture

The project is structured as a pnpm monorepo comprising separate packages for the API server, frontend, and shared libraries.

**Technical Stack:**
- **Monorepo:** pnpm workspaces
- **Backend:** Node.js (24), TypeScript (5.9), Express (5), PostgreSQL with Drizzle ORM, Zod for validation.
- **Frontend:** React, Vite, TailwindCSS, shadcn/ui, Framer Motion.
- **API Codegen:** Orval (from OpenAPI spec).

**Core Architectural Decisions:**
- **Authentication:** Custom email/password authentication with session cookies and multi-role access control (`super_admin`, `admin`, `manager`, `staff`, `consultant`, `editor`, `accountant`, `student`, `agent`, `sub_agent`, `agent_staff`, `pending`). Features include email verification, rate limiting, and open-redirect protection.
- **Role-Based Access Control (RBAC):** Granular, module-specific permissions and role-based visibility for leads and students, allowing staff to self-assign unassigned records.
- **Dynamic Pipeline Management:** Lead, application, and student pipeline stages are database-driven and fully configurable via API. Stage editor supports: notes mandatory, file attachment (with max files and mandatory upload toggle), can-go-back, case-close, country-specific visibility, color, and finance category. Finance variants: `won` (confirmed commission/service fee), `partial_won` (potential commission/service fee), `lost`, `none_finance` (excluded from commission/service fee calculations).
- **UI/UX:** Utilizes TailwindCSS and shadcn/ui for a consistent design system. Features role-based dashboards, navigation, customizable branding, and dark mode.
- **Key Features:**
    - **Public Site:** Informational pages (Home, About, Programs, Blog, Contact), DB-driven destination and program listings, and a multi-step public application flow with AI document extraction. The Apply dialog enforces degree-level-based document requirements (Associate/Bachelor: HS Diploma, HS Transcript, Passport, Photo required + Language Proof optional; Master: Bachelor Diploma/Transcript, Passport, Photo required + Equivalency Letter, CV, SOP optional; Doctorate: adds Master Diploma/Transcript; Language/Foundation: only Passport required). Public applications auto-create Application records (stage: inquiry) with commission and service fee snapshots.
    - **User Management (Admin):** Comprehensive user, role, and permission management.
    - **Student Management (Staff):** Pipeline and list views, AI-powered student creation, and bulk CSV import.
    - **Application Management (Staff):** Pipeline and list views with cascading selects and auto-fill for program details. Includes stage-specific document management with upload permissions. **Document gate on stage transitions:** when moving an application to a doc-required stage (via kanban drag, edit dialog, or detail page stage selector), the backend returns 422 DOCS_REQUIRED if no documents exist for that stage; the frontend intercepts this and opens a `StageDocUploadDialog` requiring file upload before the stage change can proceed. Doc-required stages: `app_fee_paid, offer_received, acceptance_letter, final_acceptance, upload_payment, visa_approved, student_card`.
    - **Lead Management (Staff):** Kanban pipeline and list views.
    - **Origin/Source Ownership System:** Tracks whether each Lead, Student, and Application is Direct, Agent, or Sub-Agent originated. Origin is inferred at creation from user role/agent record, inherited during conversions (lead→student, student→application) with `originLocked=true`, and displayed as color-coded badges (Direct=blue, Agent=violet, Sub-Agent=amber) on Kanban cards and detail pages. Origin filter available on all board pages. Admin-only origin override endpoints with audit logging.
    - **Finance Management (Staff):** Dynamic variant-driven finance automation for commission and service fees. Pipeline stage variants (`won`, `partial_won`, `lost`, `none_finance`) drive commission/service fee status changes: `won`→confirmed, `partial_won`→potential, `lost`/`none_finance`→excluded. Finance status is resolved dynamically from the `pipeline_stages` table at runtime (with 60s TTL cache, invalidated on pipeline save), with legacy hardcoded fallback for safety. Price snapshots are taken at application creation to ensure financial data immutability. Agent commission amounts are auto-calculated from the agent's `commissionRate` at application creation time, including sub-agent waterfall calculations.
    - **Agent Portal:** Dedicated portal with Leads, Students, and Applications pages mirroring staff functionality (with agent-scoped visibility), sub-agent management (CRUD), agent staff management (team members with granular permissions: leads, students, applications, documents, course_finder, messages, commissions, team), self-service account settings, and Web-to-Lead form (unique embed code per agent/sub-agent for collecting leads from external websites). Agent staff (`agent_staff` role) inherit their parent agent's visibility scope via `managingAgentId` FK; their sidebar is filtered based on `agentStaffPermissions` (JSONB array). **Agent badges on pipeline cards:** Leads, Students, and Applications pipeline cards display an amber badge showing the agent company name (with Building2 icon) when the record is agent-sourced. Clicking the badge navigates to `/staff/agents/:id` detail page showing agent info and tabbed lists (Leads, Students, Applications) filtered to that agent.
    - **Course Finder (Staff/Agent):** Program search, filtering, PDF proposal generation, and direct application creation.
    - **Communication Hub:** Internal messaging system supporting direct and group conversations across various channels (internal, WhatsApp, Telegram, email, SMS), broadcast messaging, message templates, and in-app notifications with configurable rules. Includes a central notification dispatcher (`notificationDispatcher.ts`) that fires both in-app and email notifications for events: lead.created, lead.assigned, lead.stage_changed, application.created, application.stage_changed, student.created, student.document_uploaded, student.status_changed, finance.commission_confirmed, agent.new_registration, agent.sub_agent_added. Notification rules are DB-driven with admin toggle for active/inactive and channel selection. Email templates are editable per-rule with variable interpolation ({{firstName}}, {{universityName}}, etc.) and live preview in the Settings → Notifications panel.
    - **Admin Settings Center:** Comprehensive configuration for branding, company information, SEO, email branding, document templates, and advanced settings.
    - **Integrations System:** Manages third-party service integrations (Communication, AI, Social Media, Custom Webhooks) with secure handling of API keys.
    - **Catalog Options:** Dynamic, database-driven management of dropdown options (degree, language, duration, fee type, intake, field) used throughout the application.
    - **Embeddable Widgets:** Allows embedding course finder and application forms on external websites, featuring an AI-powered multi-step apply form with document uploads and AI extraction.
    - **Multi-Language (i18n) System:** Supports 10 languages including RTL support, URL routing, language detection, and SEO-friendly hreflang tags.
- **Data Handling:** Consistent data structures with paginated API responses.
- **Type Safety:** Extensive use of TypeScript across the monorepo.
- **Production Deployment:** Configured for Hostinger VPS with Nginx, PM2, and a build/deploy pipeline, including static file serving and environment variable management.

## External Dependencies

-   **bcryptjs:** For password hashing.
-   **Anthropic Claude:** AI integration for document OCR and CSV parsing. API key is admin-managed via Settings → Integrations (DB-backed with 60s cache, env var fallback).
-   **PostgreSQL:** Primary database.
-   **Object Storage:** For uploaded files (invoices, receipts, branding assets).
-   **Stripe:** Implied payment processing (common in SaaS with finance systems).

## Security Audit (2026-03-24)

A comprehensive security audit was performed. Key fixes applied:
- **Critical:** Hardcoded seed passwords moved to env vars, AI route error messages sanitized, `isActive` removed from user self-patch fields (admin-only now)
- **High:** XSS in embeddable widget fixed, AI routes rate-limited, body size reduced 50→10MB, security headers added, university contact info restricted to staff/agent roles, path traversal protection on storage endpoints
- **Medium (Fixed):** CSRF double-submit cookie protection (auto-injected via `customFetch` for all mutation requests), CSP enabled in Helmet, DB foreign keys + indexes + unique constraints added, Express 5.2.1 handles async errors natively, storage upload rate limiting (30 req/15min)
- **Low (Fixed):** Sub-resource pagination on notes, follow-ups, stage documents, sub-agents
- **Soft Delete:** `deletedAt` columns added to students, applications, documents, users, leads, agents; DELETE endpoints set timestamp instead of hard-deleting; GET queries filter out deleted records
- **Student Archival (2026-04-01):** Student deletion = archive: soft-deletes student, hard-deletes all applications (cascades to stage documents), soft-deletes application-linked documents, deactivates linked user account. Re-registration with same email restores archived student with all general info and documents intact.
- **Email Uniqueness (2026-04-01):** Same email cannot be used across different roles (admin/staff/student). Enforced in user creation, student creation, auth register, public apply, and set-password endpoints. Cross-role conflict returns 409 error.
- **Database Indexes (2026-03-31):** Added missing indexes on email_queue.status, invoices (student_id, application_id, status), financial_transactions (commission_id, agent_id, type), follow_ups.created_by_id, conversations.created_by_id, messages (sender_id, conversation_id), broadcasts.sent_by_id, message_templates.created_by_id, users (role, managing_agent_id)
- **Data Consistency (2026-03-31):** email_queue timestamps now use withTimezone, commissions/service_fees season defaults updated to "2026", orphaned FK references cleaned up
- **PII Logging (2026-03-31):** Email addresses and verification codes are now masked in production logs (auth.ts)
- **Reports:** `AUDIT_REPORT.md` (full findings), `AUTHORIZATION_AUDIT.md` (endpoint-by-endpoint auth matrix)
- **Remaining:** `dangerouslySetInnerHTML` in chart (low risk), sequential DB queries in POST /applications (perf), synchronous audit log writes (perf)

## Document Management System (2026-04-01)

- **Document Requirements by Level:** `document_requirements` table stores per-level (pre_bachelors, bachelors, pre_masters, masters, phd, others) document requirements (22 doc types × 6 levels = 132 rows). Admin configures via Settings > Student Documents tab (checkbox grid for enable/mandatory per doc type per level).
- **Student Interested Level:** `interestedLevel` column on students table, editable in Add Student modal, Edit Student dialogs (both in Students.tsx pipeline and StudentDetail.tsx).
- **ZIP Download:** `GET /api/documents/download-zip/:studentId` streams a ZIP archive of all student documents.
- **PDF Merge:** `POST /api/documents/merge-pdf` merges selected documents into a single PDF using pdf-lib.
- **Application Creation Validation:** POST /api/applications validates student has firstName, lastName, email, phone, nationality, passportNumber before allowing creation. Returns 422 with `missingFields` array. Frontend shows descriptive error toast.

## Website Module (2026-04-06)

- **Foundation (Task #33):** 16 new DB tables for the Website CMS module: `website_pages`, `website_page_versions`, `website_page_blocks`, `website_navigation_menus`, `website_navigation_items`, `website_theme_tokens`, `website_global_components`, `website_forms`, `website_form_fields`, `website_blog_posts`, `website_blog_categories`, `website_blog_tags`, `website_blog_post_tags`, `website_collections_offices`, `website_collections_team_members`, `website_collections_faqs`, `website_collections_testimonials`.
- **API Routes:** All CRUD endpoints under `/api/website/` (pages, page-blocks, page-versions, navigation-menus, navigation-items, theme-tokens, global-components, forms, form-fields, blog-posts, blog-categories, blog-tags, blog-post-tags, collections/offices, collections/team-members, collections/faqs, collections/testimonials). Includes publish/unpublish for pages and blog posts (transactional). All gated with `requireAuth` + `requireRole(super_admin, admin, manager)`.
- **Admin Sidebar:** "Website" group added to admin sidebar with 10 subpages: Pages, Global Components, Navigation, Blog, Collections, Forms, SEO Overrides, Theme Builder, Translations, Publish History. Each page is a stub with "Coming soon" placeholder.
- **Schema file:** `lib/db/src/schema/website.ts`
- **API route file:** `artifacts/api-server/src/routes/website.ts`
- **Stub pages:** `artifacts/edcons/src/pages/admin/website/*.tsx`