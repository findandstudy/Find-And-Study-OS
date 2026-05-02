# EdCons OS

## Overview

EdCons OS is a production-ready SaaS for education consultancy businesses. This pnpm workspace monorepo, built with TypeScript, serves as a comprehensive operating system to streamline operations like lead management, application processing, student tracking, and financial oversight. Its purpose is to enhance efficiency, client management, and growth for staff, agents, and students in the education consultancy market. Key capabilities include dynamic pipeline management, robust role-based access control, and AI-powered document processing.

## User Preferences

The user prefers a clean, intuitive UI/UX with a focus on role-based access and clear workflows. They value dynamic content management, such as configurable pipeline stages, and robust authentication with granular permission control. AI integration should be leveraged for efficiency gains, particularly in document processing and data extraction. The system should be scalable and maintainable, built with modern web technologies.

## System Architecture

The project is structured as a pnpm monorepo comprising separate packages for the API server, frontend, and shared libraries.

**Technical Stack:**
- **Monorepo:** pnpm workspaces
- **Backend:** Node.js, TypeScript, Express, PostgreSQL with Drizzle ORM, Zod.
- **Frontend:** React, Vite, TailwindCSS, shadcn/ui, Framer Motion.
- **API Codegen:** Orval (from OpenAPI spec).

**Core Architectural Decisions:**
- **Authentication:** Custom email/password authentication with session cookies and multi-role access control. Features email verification, rate limiting, and open-redirect protection. Session management includes sliding TTL and unauthorized redirect handling.
- **Role-Based Access Control (RBAC):** Granular, module-specific permissions and role-based visibility for leads and students.
- **Dynamic Pipeline Management:** Database-driven, fully configurable pipeline stages for leads, applications, and students. Supports mandatory notes, file attachments, stage progression/reversion, country-specific visibility, and finance categorization.
- **UI/UX:** Utilizes TailwindCSS and shadcn/ui for a consistent design system, featuring role-based dashboards, navigation, customizable branding, and dark mode.
- **Key Features:**
    - **Public Site:** Informational pages, DB-driven listings, multi-step public application flow with AI document extraction, and degree-level based document requirements.
    - **User, Student, Application, Lead Management:** Comprehensive CRUD operations, AI-powered creation, bulk CSV import, stage-specific document management, and self-service student registration.
    - **Origin/Source Ownership System:** Tracks lead, student, and application origins (Direct, Agent, Sub-Agent).
    - **Finance Management:** Dynamic variant-driven finance automation for commission and service fees, with price snapshots and auto-calculated agent commissions.
    - **Agent Portal:** Dedicated portal with agent-scoped visibility, sub-agent and agent staff management, self-service account settings, and Web-to-Lead forms.
    - **Course Finder:** Program search, filtering, PDF proposal generation, and direct application creation.
    - **Communication Hub:** Internal messaging, broadcast messaging, message templates, and in-app notifications.
    - **Admin Settings Center:** Comprehensive configuration for branding, company information, SEO, email branding, document templates, and integrations.
    - **Integrations System:** Manages third-party service integrations (Communication, AI, Social Media, Custom Webhooks).
    - **Catalog Options:** Dynamic, database-driven management of dropdown options.
    - **Agent Contract Management:** Tracks contract validity with automated expiry notifications.
    - **Embeddable Widgets:** Course finder and AI-powered multi-step application forms for external websites.
    - **Omnichannel Inbox:** Integrates WhatsApp and web form messages into a centralized inbox with identity resolution and templated replies.
    - **Tasks (Görev Yönetimi):** Kanban board for task management with customizable columns, priorities, assignees, and chat-style notes. Includes role-based access and soft-delete archiving.
    - **Multi-Language (i18n) System:** Supports multiple languages including RTL, URL routing, and SEO-friendly hreflang tags.
    - **Document Management System:** Defines document requirements by education level, supports ZIP download, PDF merging, and validates program eligibility (GPA, language scores). Features re-apply without re-uploading logic and document type equivalence.
    - **Website Module:** Full CMS with theme builder, page editor (block-based with 14 block types and global components), draft/publish/version control, SEO overrides, form builder with spam protection, and AI content assistant.
- **Data Handling:** Consistent data structures, paginated API responses, and extensive use of soft deletes.
- **Type Safety:** Extensive use of TypeScript across the monorepo.
- **Production Deployment:** Configured for Hostinger VPS with Nginx and PM2.
- **Zero-Flash Routing:** In-memory routing to prevent browser history updates for a smoother Replit experience.
- **Resilient Error Recovery:** Lazy routes are wrapped in `ErrorBoundary` with cache-busted reload attempts and detailed error reporting.

## External Dependencies

-   **bcryptjs:** For password hashing.
-   **Anthropic Claude:** AI integration for document OCR and CSV parsing.
-   **PostgreSQL:** Primary database.
-   **Object Storage:** For uploaded files.
-   **Stripe:** Implied payment processing.