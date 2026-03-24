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
- **Authentication:** Custom email/password authentication with session cookies and multi-role access control (`super_admin`, `admin`, `manager`, `staff`, `consultant`, `editor`, `accountant`, `student`, `agent`, `sub_agent`, `pending`). Features include email verification, rate limiting, and open-redirect protection.
- **Role-Based Access Control (RBAC):** Granular, module-specific permissions and role-based visibility for leads and students, allowing staff to self-assign unassigned records.
- **Dynamic Pipeline Management:** Lead, application, and student pipeline stages are database-driven and fully configurable via API.
- **UI/UX:** Utilizes TailwindCSS and shadcn/ui for a consistent design system. Features role-based dashboards, navigation, customizable branding, and dark mode.
- **Key Features:**
    - **Public Site:** Informational pages (Home, About, Programs, Blog, Contact), DB-driven destination and program listings, and a multi-step public application flow with AI document extraction.
    - **User Management (Admin):** Comprehensive user, role, and permission management.
    - **Student Management (Staff):** Pipeline and list views, AI-powered student creation, and bulk CSV import.
    - **Application Management (Staff):** Pipeline and list views with cascading selects and auto-fill for program details. Includes stage-specific document management with upload permissions.
    - **Lead Management (Staff):** Kanban pipeline and list views.
    - **Finance Management (Staff):** Stage-based finance automation for commission and service fees, with dual-status tracking and configurable exclusion criteria. Price snapshots are taken at application creation to ensure financial data immutability.
    - **Agent Portal:** Dedicated portal with Leads, Students, and Applications pages mirroring staff functionality (with agent-scoped visibility), sub-agent management (CRUD), and self-service account settings.
    - **Course Finder (Staff/Agent):** Program search, filtering, PDF proposal generation, and direct application creation.
    - **Communication Hub:** Internal messaging system supporting direct and group conversations across various channels (internal, WhatsApp, Telegram, email, SMS), broadcast messaging, message templates, and in-app notifications with configurable rules.
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
- **Medium (Fixed):** CSRF double-submit cookie protection, CSP enabled in Helmet, DB foreign keys + indexes + unique constraints added, Express 5.2.1 handles async errors natively, storage upload rate limiting (30 req/15min)
- **Low (Fixed):** Sub-resource pagination on notes, follow-ups, stage documents, sub-agents
- **Soft Delete:** `deletedAt` columns added to students, applications, documents; DELETE endpoints set timestamp instead of hard-deleting; GET queries filter out deleted records
- **Reports:** `AUDIT_REPORT.md` (full findings), `AUTHORIZATION_AUDIT.md` (endpoint-by-endpoint auth matrix)
- **Remaining:** `dangerouslySetInnerHTML` in chart (low risk), sequential DB queries in POST /applications (perf), synchronous audit log writes (perf)